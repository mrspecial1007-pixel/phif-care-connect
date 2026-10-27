import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderReceiptDateEditor } from "../../components/management/OrderReceiptDateEditor";
import { attachOrderReceipts, type OrderReceiptRecord } from "../phif-order-receipts.helpers";
import { loadOrderReceipts, observeOrderReceipts, persistOrderReceiptDate } from "../phif-order-receipts.server";
import { orderDuration, ordersView, ordersExportRows, defaultOrdersFilters } from "../phif-orders.helpers";
import { buildOrdersPdf, buildOrdersWorkbook } from "../phif-orders-export";
import { ordersFixture } from "./fixtures/phif-orders.fixture";
import { resolve } from "node:path";
const record = (patch: Partial<OrderReceiptRecord> = {}): OrderReceiptRecord => ({ id:"00000000-0000-4000-8000-000000000001",
  pharmacy_id:"tiryaq",order_id:"10326",line_id:"60697",order_number:"ORD_242_266_10326",order_created_at:"2026-10-13T02:38:20Z",
  medicine:ordersFixture().orders[0].lines[1].medicine,batch:"00123",status:"received",first_received_observed_at:"2026-10-22T09:30:00Z",
  confirmed_received_on:null,confirmed_by:null,confirmed_at:null,version:2,...patch });
const context = { pharmacy_id:"tiryaq",session:{data:{user_id:"manager",user_role:"admin"}} };
describe("separate manual and observed receipt dates", () => {
  it("uses a calendar-day manual date, never the observation timestamp, without mutating the PHIF snapshot", () => {
    const report=ordersFixture(), before=JSON.stringify(report);
    const observed=attachOrderReceipts(report,[record()]);
    const line=ordersView(observed,defaultOrdersFilters).rows.find(l=>l.id==='60697')!;
    expect(line.duration.days).toBeNull();expect(line.receipt?.first_received_observed_at).toBeTruthy();
    const confirmed=attachOrderReceipts(report,[record({confirmed_received_on:'2026-10-18'})]);
    expect(ordersView(confirmed,defaultOrdersFilters).rows.find(l=>l.id==='60697')?.duration.days).toBe(5);
    expect(JSON.stringify(report)).toBe(before);
    expect(orderDuration({...line,receipt:record({confirmed_received_on:'2026-10-13'})}).days).toBe(0);
  });
  it("does not attach another order's, medicine's or batch's dates and keeps source receipt dates independent", () => {
    for(const patch of [{order_id:'999'},{line_id:'999'},{medicine:'OTHER'},{batch:'OTHER'},{order_number:'OTHER'}]) {
      expect(attachOrderReceipts(ordersFixture(),[record(patch)]).orders[0].lines[1].receipt).toBeUndefined();
    }
    const report=ordersFixture();report.orders[0].lines[1].receivedAt='2026-10-18T02:38:20Z';
    expect(ordersView(attachOrderReceipts(report,[record()]),defaultOrdersFilters).rows.find(l=>l.id==='60697')?.duration.days).toBe(5);
  });
  it("filters receipt and observation months independently, excludes unconfirmed dates, and maintains status statistics", () => {
    const report=attachOrderReceipts(ordersFixture(),[record({confirmed_received_on:'2026-10-18',first_received_observed_at:'2026-11-01T09:00:00Z'})]);
    const filters={...defaultOrdersFilters,period:'custom' as const,dateFrom:'2026-10-01',dateTo:'2026-10-31',dateBasis:'receipt' as const};
    expect(ordersView(report,filters).counts).toEqual({received:1,waiting:0,not_approved:0,review:0});
    expect(ordersView(report,{...filters,dateBasis:'observation'}).rows).toHaveLength(0);
    expect(ordersView(report,{...filters,dateBasis:'observation',dateFrom:'2026-11-01',dateTo:'2026-11-30'}).rows).toHaveLength(1);
    const unconfirmed=attachOrderReceipts(ordersFixture(),[record()]);
    expect(ordersView(unconfirmed,filters).orderCount).toBe(0);
    expect(ordersView(unconfirmed,defaultOrdersFilters).counts).toEqual({received:1,waiting:3,not_approved:1,review:0});
  });
  it("exports actual/manual and first-observed dates separately to Excel and generates the all-status PDF", async () => {
    const report=attachOrderReceipts(ordersFixture(),[record({confirmed_received_on:'2026-10-18'})]);
    const rows=ordersExportRows(report,defaultOrdersFilters);expect(rows.find(r=>r.status==='تم الاستلام')).toMatchObject({
      ageDays:5,receivedAt:'2026-10-18',receiptSource:'مؤكد يدويًا',firstObservedAt:'2026-10-22T09:30:00Z'});
    const workbook=await buildOrdersWorkbook(report,defaultOrdersFilters), sheet=workbook.getWorksheet('أصناف الطلبات')!;
    expect(sheet.getColumn('receiptSource').values).toContain('مؤكد يدويًا');
    expect(sheet.getColumn('firstObservedAt').values.some(v=>v instanceof Date)).toBe(true);
    const blob=await buildOrdersPdf(report,defaultOrdersFilters,{regular:resolve('public/fonts/Amiri-Regular.ttf'),bold:resolve('public/fonts/Amiri-Bold.ttf')},Date.now(),false);
    expect(Buffer.from(await blob.arrayBuffer()).subarray(0,4).toString()).toBe('%PDF');
  },30000);
  it("exposes a disabled manual editor when a tracked record or migration is unavailable", () => {
    const html=renderToStaticMarkup(<OrderReceiptDateEditor record={record()} medicine="Test" enabled={false} onSaved={()=>{}} />);
    expect(html).toContain('disabled');expect(html).toContain('تحديد تاريخ الاستلام');
  });
});

describe("receipt server authorization and safety", () => {
  it("rejects employee and legacy writes before calling RPC and derives the pharmacy/actor from the server session", async () => {
    const db={rpc:vi.fn(async()=>({data:record({confirmed_received_on:'2026-10-18'}),error:null}))};
    const input={orderId:'10326',lineId:'60697',receivedOn:'2026-10-18',expectedVersion:2};
    for(const data of [{user_id:'employee',user_role:'employee'},{}]) await expect(persistOrderReceiptDate(db,{...context,session:{data}},input)).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
    await persistOrderReceiptDate(db,context,{...input,pharmacyId:'andalus',actorId:'foreign'});
    expect(db.rpc.mock.calls[0]).toEqual(['set_phif_order_receipt_date',expect.objectContaining({p_pharmacy_id:'tiryaq',p_actor_id:'manager'})]);
  });
  it("shows conflict/save errors and rejects foreign RPC results", async () => {
    const input={orderId:'10326',lineId:'60697',receivedOn:null,expectedVersion:2};
    await expect(persistOrderReceiptDate({rpc:async()=>({error:{message:'Version conflict'}})},context,input)).rejects.toThrow('تغير السجل');
    await expect(persistOrderReceiptDate({rpc:async()=>({data:record({pharmacy_id:'andalus'})})},context,input)).rejects.toThrow('غير متوافقة');
  });
  it("reports unapplied migrations, scopes reads, and refuses partial observations without any write", async () => {
    const calls:any[]=[];
    const query:any={select:()=>query,eq:(k:string,v:string)=>{calls.push([k,v]);return query;},limit:async()=>({error:{code:'PGRST205'}})};
    const db={from:()=>query,rpc:vi.fn()};
    expect(await loadOrderReceipts(db,'tiryaq')).toMatchObject({ready:false,missing:true});
    expect(calls).toContainEqual(['pharmacy_id','tiryaq']);
    await expect(observeOrderReceipts(db,'tiryaq','manager',{...ordersFixture(),complete:false})).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await observeOrderReceipts(db,'tiryaq','manager',ordersFixture())).toMatchObject({missing:true});
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("keeps legacy PIN refresh read-only without attributing an observation to a fake actor", async () => {
    const query:any={select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,
      range:async()=>({data:[],count:0,error:null}),then:(resolve:any)=>resolve({error:null})};
    const db={from:()=>query,rpc:vi.fn()};
    expect(await observeOrderReceipts(db,'tiryaq',undefined,ordersFixture())).toMatchObject({ready:true});
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
