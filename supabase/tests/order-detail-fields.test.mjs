// Isolated in-memory PostgreSQL only. Never accepts a Cloud connection.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PHIF_TEST_PGLITE_MODULE ? pathToFileURL(process.env.PHIF_TEST_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const deny=async (fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
async function rpc(sql,args=[],role='service_role') { await db.exec(`SET ROLE ${role}`);try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');} }
const begin=(kind='orders',actor=id(3),pharmacy=id(1),session=id(7),role)=>rpc('SELECT begin_phif_manual_sync($1,$2,$3,$4) AS op',[pharmacy,actor,kind,session],role).then(r=>r.rows[0].op);
const report=()=>({pharmacy:'صيدلية الترياق الشافي',complete:true,totalOrders:1,pages:1,excludedZero:0,fetchedAt:new Date().toISOString(),orders:[{
  id:'10',number:'ORD_10',createdAt:'2020-01-01T00:00:00Z',status:'تم القبول',detailError:null,lines:[{
    id:'100',medicine:'Test tablet',supplier:'Supplier',batch:'0001',approval:'تم القبول',approvedQuantity:2,quantityMissing:false,
    status:'waiting',approvedAt:null,receivedAt:null}]}]});
const complete=(op,r=report(),version=0,actor=id(3),pharmacy=id(1))=>rpc('SELECT complete_phif_orders_sync($1,$2,$3,$4,$5::jsonb) AS v',[pharmacy,actor,op.id,version,JSON.stringify(r)]);
const cool=()=>db.exec("UPDATE phif_manual_sync_operations SET started_at=started_at-interval '20 seconds',finished_at=finished_at-interval '20 seconds'");
try {
  await db.exec(`CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE pharmacies(id uuid PRIMARY KEY,name text);
    CREATE TABLE pharmacy_users(id uuid PRIMARY KEY,pharmacy_id uuid,role text,is_active boolean,permissions jsonb DEFAULT '{}');
    CREATE TABLE phif_bridge_sessions(id uuid PRIMARY KEY,pharmacy_id uuid,status text,expires_at timestamptz);
    CREATE TABLE user_operation_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pharmacy_id uuid,user_id uuid,action text,entity text,entity_id uuid,metadata jsonb);
    INSERT INTO pharmacies VALUES('${id(1)}','صيدلية الترياق الشافي'),('${id(2)}','صيدلية الأندلس');
    INSERT INTO pharmacy_users VALUES('${id(3)}','${id(1)}','admin',true,'{}'),('${id(4)}','${id(1)}','employee',true,'{"inventory_read":true}'),
      ('${id(5)}','${id(2)}','admin',true,'{}'),('${id(6)}','${id(1)}','admin',false,'{}'),('${id(9)}','${id(1)}','employee',true,'{}');
    INSERT INTO phif_bridge_sessions VALUES('${id(7)}','${id(1)}','active',now()+interval '4 hours'),('${id(8)}','${id(2)}','active',now()+interval '4 hours');`);
  for(const migration of ['20260928010000_add_phif_stock_snapshots.sql','20261025010000_add_phif_order_receipts.sql','20261026010000_add_shared_orders_and_manual_sync.sql'])
    await db.exec(readFileSync(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));

  const migration = readFileSync(new URL('../migrations/20261125010000_allow_order_detail_fields.sql', import.meta.url),'utf8');
  const rollback = readFileSync(new URL('../rollback/20261125010000_restore_order_detail_validation.sql', import.meta.url),'utf8');
  const metadata = async () => (await db.query("SELECT oid,proowner,proacl,prosecdef,proconfig,pg_get_function_identity_arguments(oid) AS args,prorettype FROM pg_proc WHERE proname='complete_phif_orders_sync'")).rows[0];
  const oldMeta = await metadata();
  const original = (await db.query("SELECT prosrc FROM pg_proc WHERE proname='complete_phif_orders_sync'")).rows[0].prosrc;
  const oldOp = await begin(); const legacy = report(); await complete(oldOp, legacy);
  await cool();
  await db.exec(migration);
  assert.deepEqual(await metadata(), oldMeta); checks++;
  check((await db.query('SELECT report FROM phif_order_snapshots')).rows[0].report.orders[0].lines[0].approvedAt === null, 'migration leaves existing data unchanged');
  const updated = (await db.query("SELECT prosrc FROM pg_proc WHERE proname='complete_phif_orders_sync'")).rows[0].prosrc;
  const removeValidation = s => s.replace(/  IF EXISTS\(SELECT 1 FROM jsonb_array_elements\(p_report->'orders'\) o CROSS JOIN LATERAL[\s\S]*?END IF;/, '<line-validation>');
  assert.equal(removeValidation(updated), removeValidation(original)); checks++;
  for (const role of ['anon','authenticated']) await deny(() => rpc('SELECT complete_phif_orders_sync($1,$2,$3,1,$4::jsonb)', [id(1),id(3),id(99),JSON.stringify(report())],role),/permission denied/);
  const op = await begin();
  for (const actor of [id(5),id(6),id(9)]) await deny(() => complete(op,report(),1,actor));
  await deny(() => complete(op,report(),1,id(3),id(2)));
  await deny(() => complete(op,report(),0),/Version conflict/);
  const state = async () => (await db.query("SELECT (SELECT jsonb_agg(t) FROM phif_order_snapshots t) s,(SELECT jsonb_agg(t) FROM phif_order_receipts t) r,(SELECT jsonb_agg(t) FROM user_operation_log t) a,(SELECT jsonb_agg(t) FROM phif_manual_sync_operations t) o")).rows[0];
  const pristine = await state();
  const rejectLine = async patch => {
    const r = report(); Object.assign(r.orders[0].lines[0],patch);
    await deny(() => complete(op,r,1));
    assert.deepEqual(await state(), pristine); checks++;
  };
  for (const key of ['requestedQuantity','supplierQuantity','receivedQuantity']) {
    for (const value of [-1,'2',true,{},[], 'NaN']) await rejectLine({[key]:value});
  }
  for (const key of ['approvedAt','deliveredAt']) {
    for (const value of ['', '2026-02-30T12:00:00Z','2026-11-25T25:00:00Z','2026-11-25','infinity',12,true,{},'2026-11-25T12:00:00'])
      await rejectLine({[key]:value});
  }
  for (const value of [23,'','12x',{},false]) await rejectLine({batchId:value});
  for (const value of [null,'unknown',{},'received']) await rejectLine({fulfillmentStage:value});
  await rejectLine({unknownField:'unexpected'});
  await rejectLine({approvedQuantity:0});
  const partial=report(); partial.complete=false; await deny(()=>complete(op,partial,1));
  const omitted=report(); omitted.orders=[]; omitted.totalOrders=0; await deny(()=>complete(op,omitted,1));
  assert.deepEqual(await state(),pristine); checks++;
  const modern = report();
  Object.assign(modern.orders[0].lines[0], {batchId:'00123',requestedQuantity:30,supplierQuantity:20,
    receivedQuantity:null,fulfillmentStage:'ready',approvedAt:'2026-11-12T14:51:00+02:00',
    deliveredAt:'2026-11-22T10:45:00.000Z'});
  // Simulate failure after receipt observation: all writes must roll back.
  await db.exec("CREATE FUNCTION test_reject_orders_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phif_orders_snapshot_saved' THEN RAISE EXCEPTION 'audit outage'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_orders_audit BEFORE INSERT ON user_operation_log FOR EACH ROW EXECUTE FUNCTION test_reject_orders_audit()");
  await deny(()=>complete(op,modern,1),/audit outage/);
  assert.deepEqual(await state(),pristine); checks++;
  await db.exec('DROP TRIGGER reject_orders_audit ON user_operation_log; DROP FUNCTION test_reject_orders_audit()');
  modern.fetchedAt=new Date().toISOString(); await complete(op,modern,1);
  assert.deepEqual((await db.query('SELECT report FROM phif_order_snapshots')).rows[0].report,modern);checks++;
  const saved=await state();await complete(op,modern,1);assert.deepEqual(await state(),saved);checks++;
  let version=2;
  // Legacy, nullable fields, numeric zero/fraction, all stage mappings and old ISO dates.
  for (const patch of [{},
    {batchId:null,requestedQuantity:null,supplierQuantity:null,receivedQuantity:null,deliveredAt:null,approvedAt:null},
    {requestedQuantity:0,supplierQuantity:0,receivedQuantity:0.5,approvedAt:'2020-02-29T12:00:00Z'},
    {fulfillmentStage:'in_delivery'},
    {status:'not_approved',fulfillmentStage:'not_approved',approvedQuantity:null},
    {status:'review',fulfillmentStage:'review'},
    {status:'received',fulfillmentStage:'received',receivedAt:'2026-11-24T23:05:00Z',receivedQuantity:2}]) {
    await cool(); const next=await begin();const r=report();Object.assign(r.orders[0].lines[0],patch);
    await complete(next,r,version++);
    assert.deepEqual((await db.query('SELECT report FROM phif_order_snapshots')).rows[0].report,r);checks++;
  }
  const beforeRollback=await state();
  await db.exec(rollback);
  assert.deepEqual(await metadata(),oldMeta);checks++;
  assert.equal((await db.query("SELECT prosrc FROM pg_proc WHERE proname='complete_phif_orders_sync'")).rows[0].prosrc,original);checks++;
  assert.deepEqual(await state(),beforeRollback);checks++;
  await db.exec(migration);
  assert.deepEqual(await metadata(),oldMeta);checks++;
  console.log(JSON.stringify({checks,result:'PASS',engine:'isolated in-memory PostgreSQL/PGlite',cloudConnections:0}));
} finally { await db.close(); }
