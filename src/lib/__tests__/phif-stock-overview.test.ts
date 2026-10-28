import { describe, it, expect } from "vitest";
import { readPhifStockOverview } from "../phif-stock-overview.server";
import { readFileSync } from "node:fs";

describe("stock saved state versus last attempt", () => {
  it("retains the successful snapshot separately from an old closure or a new failure", async () => {
    const calls: any[] = [], success = { id: "successful", status: "completed", total_records: 166, imported_records: 20 };
    for (const failure of [{id:"legacy",status:"failed",error_message:"Closed by approved maintenance"}, {id:"new",status:"failed"}]) {
      const db = {from:(table:string) => {
        let completed = false;
        const q: any = {select:()=>q,eq:(key:string,value:unknown)=>{calls.push([table,key,value]);if(key==="status")completed=value==="completed";return q;},
          order:()=>q,limit:()=>q,maybeSingle:async()=>({data:completed?success:failure,error:null}),
          then:(resolve:any)=>resolve({count:166,error:null})}; return q;
      }};
      expect(await readPhifStockOverview(db,"tiryaq")).toEqual({last_run:failure,last_successful_run:success,current_count:166});
    }
    expect(calls.filter(c=>c[1]==="pharmacy_id").every(c=>c[2]==="tiryaq")).toBe(true);
  });
  it("keeps metadata reads passive and preserves local IndexedDB", () => {
    const stock=readFileSync("src/lib/phif-stock-overview.server.ts","utf8");expect(stock).not.toMatch(/\.(insert|update|delete|rpc)\(|\bfetch\(/);
    const cache=readFileSync("src/lib/use-stored-phif-orders.ts","utf8");expect(cache).not.toMatch(/ordersStore\.(clear|delete|remove)/);
    expect(cache).toContain("manualSyncAccess?.ready === false");expect(cache).toContain("accessDenied");
  });
});
