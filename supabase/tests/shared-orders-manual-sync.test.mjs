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
const stock=(op,rows,pharmacy=id(1))=>rpc('SELECT replace_phif_stock_snapshots($1,$2,$3::jsonb) AS n',[pharmacy,op.id,JSON.stringify(rows)]);
const item={source_stock_id:'100',content_hash:'hash1',brand_name:'Test tablet',cost_price:0.563,stock_quantity:0};
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
  for(const actor of [null,id(5),id(6),id(9)]) await deny(()=>begin('orders',actor));
  await deny(()=>begin('orders',id(3),id(2),id(8)));
  await deny(()=>begin('orders',id(3),id(1),id(8)));
  for(const role of ['anon','authenticated']) {
    await deny(()=>begin('orders',id(3),id(1),id(7),role));
    await deny(()=>rpc('SELECT * FROM phif_order_snapshots',[],role));
  }
  await deny(()=>rpc("INSERT INTO phif_order_snapshots VALUES($1,'{}',1,now(),$2,now())",[id(1),id(3)]));
  await deny(()=>rpc("UPDATE phif_manual_sync_operations SET status='failed',finished_at=now()"));
  const first=await begin();
  await deny(()=>begin()); await deny(()=>begin('stock'));
  await deny(()=>complete(first,report(),0,id(4)));
  await deny(()=>rpc('SELECT fail_phif_manual_sync($1,$2,$3)',[id(1),id(4),first.id]));
  const r=report();await complete(first,r);
  check((await db.query('SELECT version FROM phif_order_snapshots')).rows[0].version===1,'central snapshot saved');
  check((await db.query('SELECT * FROM phif_order_receipts')).rows.length===1,'receipt baseline committed atomically');
  const logCount=(await db.query('SELECT * FROM user_operation_log')).rows.length;
  await complete(first,r);
  check((await db.query('SELECT * FROM user_operation_log')).rows.length===logCount,'retry has no extra audit or snapshot writes');
  await db.query("UPDATE phif_manual_sync_operations SET started_at=started_at-interval '2 minutes' WHERE id=$1",[first.id]);
  await deny(()=>begin(),/PHIF_SYNC_COOLDOWN/); await cool();
  const next=await begin('orders',id(4));
  await deny(()=>complete(next,report(),0,id(4)));
  const repeatedTimestamp=report();repeatedTimestamp.fetchedAt=r.fetchedAt;repeatedTimestamp.orders[0].lines[0].status='received';
  await deny(()=>complete(next,repeatedTimestamp,1,id(4)),/Stale order read/);
  const numericIdentity=report();numericIdentity.orders[0].lines[0].id=200;
  await deny(()=>complete(next,numericIdentity,1,id(4)),/Invalid order line fields/);
  const incomplete=report();incomplete.orders=[];incomplete.totalOrders=0;
  await deny(()=>complete(next,incomplete,1,id(4)));
  const credentials=report();credentials.cookies='must not be stored';await deny(()=>complete(next,credentials,1,id(4)));
  const zero=report();zero.orders[0].lines[0].approvedQuantity=0;await deny(()=>complete(next,zero,1,id(4)));
  const changed=report();changed.orders[0].lines[0].medicine='Different identity';
  await deny(()=>complete(next,changed,1,id(4)));
  check((await db.query('SELECT version FROM phif_order_snapshots')).rows[0].version===1,'failed/partial reads preserve central snapshot');
  await rpc('SELECT fail_phif_manual_sync($1,$2,$3)',[id(1),id(4),next.id]);await cool();
  const receipt=await begin();const received=report();received.orders[0].lines[0].status='received';await complete(receipt,received,1);
  const row=(await db.query('SELECT * FROM phif_order_receipts')).rows[0];
  check(Boolean(row.first_received_observed_at),'transition observation recorded');
  await rpc("SELECT set_phif_order_receipt_date($1,$2,'10','100','2020-01-02',$3)",[id(1),id(3),row.version]);
  await cool();const refresh=await begin();await complete(refresh,reportWithReceived(),2);
  check((await db.query('SELECT confirmed_received_on FROM phif_order_receipts')).rows[0].confirmed_received_on.toISOString().startsWith('2020-01-02'),'later sync preserves manual date');
  await cool();const s=await begin('stock');await stock(s,[item]);
  const run=(await db.query('SELECT * FROM phif_stock_sync_runs WHERE id=$1',[s.id])).rows[0];
  check(run.status==='completed'&&run.imported_records===1,'stock and terminal run state commit together');
  check((await db.query('SELECT stock_quantity,cost_price FROM phif_stock_items')).rows[0].stock_quantity==='0','zero stock retained');
  await stock(s,[{...item,cost_price:99}]);
  check((await db.query('SELECT cost_price FROM phif_stock_items')).rows[0].cost_price==='0.563000','duplicate completion cannot rewrite data');
  await cool();const unchanged=await begin('stock');await stock(unchanged,[item]);
  const unchangedRun=(await db.query('SELECT status,imported_records,total_records FROM phif_stock_sync_runs WHERE id=$1',[unchanged.id])).rows[0];
  check(unchangedRun.status==='completed'&&unchangedRun.imported_records===0&&unchangedRun.total_records===1,'a no-change stock read completes atomically rather than remaining pending');
  await cool();const expired=await begin('stock');
  await db.query("UPDATE phif_manual_sync_operations SET started_at=now()-interval '5 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);
  const replacement=await begin('stock');
  check((await db.query('SELECT status FROM phif_stock_sync_runs WHERE id=$1',[expired.id])).rows[0].status==='failed','only expired managed run reclaimed');
  await deny(()=>stock(expired,[{...item,content_hash:'stale',cost_price:99}]));
  await stock(replacement,[{...item,content_hash:'hash2',cost_price:0.6}]);
  check((await db.query('SELECT cost_price FROM phif_stock_items WHERE is_current')).rows[0].cost_price==='0.600000','stale worker fenced');
  await cool();const failure=await begin('stock');
  await db.exec(`CREATE FUNCTION test_reject_sync_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='phif_stock_sync_completed' THEN RAISE EXCEPTION 'Simulated audit outage'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_audit_outage BEFORE INSERT ON user_operation_log FOR EACH ROW EXECUTE FUNCTION test_reject_sync_audit();`);
  await deny(()=>stock(failure,[{...item,content_hash:'failed-audit',cost_price:88}]));
  check((await db.query('SELECT cost_price FROM phif_stock_items WHERE is_current')).rows[0].cost_price==='0.600000','audit failure rolls back snapshot and terminal state together');
  check((await db.query('SELECT status FROM phif_stock_sync_runs WHERE id=$1',[failure.id])).rows[0].status==='pending','failed completion cannot falsely mark a run completed');
  await db.exec('DROP TRIGGER test_audit_outage ON user_operation_log; DROP FUNCTION test_reject_sync_audit()');
  await deny(()=>stock(failure,[{...item,content_hash:'hash3',cost_price:0.7},{...item,source_stock_id:'101',content_hash:'hash4',cost_price:'invalid'}]));
  check((await db.query('SELECT cost_price FROM phif_stock_items WHERE is_current')).rows[0].cost_price==='0.600000','partial stock write rolls back');
  await rpc('SELECT fail_phif_manual_sync($1,$2,$3)',[id(1),id(3),failure.id]);await cool();
  await db.query("INSERT INTO phif_stock_sync_runs(id,pharmacy_id,status,started_at) VALUES($1,$2,'pending',now()-interval '10 days')",[id(50),id(1)]);
  await deny(()=>begin('stock'));await deny(()=>stock({id:id(50)},[item]));
  check((await db.query('SELECT status FROM phif_stock_sync_runs WHERE id=$1',[id(50)])).rows[0].status==='pending','legacy pending never reset by age');
  check(!(await db.query('SELECT * FROM phif_order_snapshots WHERE pharmacy_id=$1',[id(2)])).rows.length,'Andalus untouched');
  check((await db.query("SELECT proconfig FROM pg_proc WHERE proname='complete_phif_orders_sync'")).rows[0].proconfig.includes('search_path=pg_catalog, pg_temp'),'safe function search path');
  // Effective privileges are tested even with BYPASSRLS and inherited column grants.
  const migration=readFileSync(new URL('../migrations/20261026010000_add_shared_orders_and_manual_sync.sql',import.meta.url),'utf8');
  const privileges=migration.match(/DO \$privileges\$[\s\S]*?END \$privileges\$;/)[0];
  const preflight=migration.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)[0];
  await db.exec(privileges);checks++;
  await db.exec('GRANT UPDATE ON phif_order_snapshots TO PUBLIC');
  await deny(()=>db.exec(privileges),/Unsafe table write privileges/);
  await db.exec('REVOKE UPDATE ON phif_order_snapshots FROM PUBLIC');
  await db.exec('CREATE ROLE test_inherited_writer NOLOGIN; GRANT UPDATE(version) ON phif_order_snapshots TO test_inherited_writer; GRANT test_inherited_writer TO service_role');
  await deny(()=>db.exec(privileges),/Unsafe table write privileges/);
  await db.exec('REVOKE test_inherited_writer FROM service_role; REVOKE UPDATE(version) ON phif_order_snapshots FROM test_inherited_writer; DROP ROLE test_inherited_writer');
  await db.exec('CREATE ROLE test_snapshot_owner NOLOGIN; ALTER TABLE phif_order_snapshots OWNER TO test_snapshot_owner; GRANT test_snapshot_owner TO service_role');
  await deny(()=>db.exec(privileges),/Unsafe table write privileges/);
  await db.exec('ALTER TABLE phif_order_snapshots OWNER TO postgres; REVOKE test_snapshot_owner FROM service_role; DROP ROLE test_snapshot_owner');
  await db.exec('GRANT SELECT ON phif_order_snapshots TO anon');
  await deny(()=>db.exec(privileges),/Unsafe table access/);
  await db.exec('REVOKE SELECT ON phif_order_snapshots FROM anon');
  await db.exec('GRANT EXECUTE ON FUNCTION complete_phif_orders_sync(uuid,uuid,uuid,integer,jsonb) TO authenticated');
  await deny(()=>db.exec(privileges),/Unsafe RPC ownership/);
  await db.exec('REVOKE EXECUTE ON FUNCTION complete_phif_orders_sync(uuid,uuid,uuid,integer,jsonb) FROM authenticated');
  await db.exec('GRANT EXECUTE ON FUNCTION _apply_phif_stock_snapshots(uuid,uuid,jsonb) TO service_role');
  await deny(()=>db.exec(privileges),/Internal helpers/);
  await db.exec('REVOKE EXECUTE ON FUNCTION _apply_phif_stock_snapshots(uuid,uuid,jsonb) FROM service_role');
  await db.exec('ALTER ROLE service_role CREATEROLE');
  await deny(()=>db.exec(privileges),/Unsafe service role/);
  await db.exec('ALTER ROLE service_role NOCREATEROLE');
  await db.exec('ALTER FUNCTION begin_phif_manual_sync(uuid,uuid,text,uuid) RESET search_path');
  await deny(()=>db.exec(privileges),/search path/);
  await db.exec('ALTER FUNCTION begin_phif_manual_sync(uuid,uuid,text,uuid) SET search_path=pg_catalog,pg_temp');
  await db.exec('ALTER TABLE phif_order_receipts RENAME COLUMN medicine TO incompatible_medicine');
  await deny(()=>db.exec(preflight),/schema contract mismatch/);
  await db.exec('ALTER TABLE phif_order_receipts RENAME COLUMN incompatible_medicine TO medicine');
  await deny(()=>db.exec(preflight),/already exist/);
  await db.exec(privileges);checks++;
} finally { await db.close(); }
// Prove that an unsafe inherited default grant aborts the ENTIRE migration,
// including the stock-RPC rename. This is a separate disposable database.
const rollbackDb=new PGlite();
try {
  await rollbackDb.exec(`CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE pharmacies(id uuid PRIMARY KEY,name text);
    CREATE TABLE pharmacy_users(id uuid PRIMARY KEY,pharmacy_id uuid,role text,is_active boolean,permissions jsonb DEFAULT '{}');
    CREATE TABLE phif_bridge_sessions(id uuid PRIMARY KEY,pharmacy_id uuid,status text,expires_at timestamptz);
    CREATE TABLE user_operation_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pharmacy_id uuid,user_id uuid,action text,entity text,entity_id uuid,metadata jsonb);`);
  for(const name of ['20260928010000_add_phif_stock_snapshots.sql','20261025010000_add_phif_order_receipts.sql'])
    await rollbackDb.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  await rollbackDb.exec('CREATE ROLE test_default_writer NOLOGIN; GRANT test_default_writer TO service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT UPDATE ON TABLES TO test_default_writer');
  await deny(()=>rollbackDb.exec(readFileSync(new URL('../migrations/20261026010000_add_shared_orders_and_manual_sync.sql',import.meta.url),'utf8')),/Unsafe table write privileges/);
  await rollbackDb.exec('ROLLBACK');
  const state=(await rollbackDb.query(`SELECT to_regclass('public.phif_order_snapshots') AS snapshots,
    to_regclass('public.phif_manual_sync_operations') AS operations,
    to_regprocedure('public._apply_phif_stock_snapshots(uuid,uuid,jsonb)') AS internal,
    to_regprocedure('public.replace_phif_stock_snapshots(uuid,uuid,jsonb)') AS original,
    to_regclass('public.phif_order_receipts') AS receipts`)).rows[0];
  check(state.snapshots===null&&state.operations===null,'failed migration leaves no partial new tables');
  check(state.internal===null&&state.original!==null,'stock RPC rename and grants roll back');
  check(state.receipts!==null,'installed receipt schema is retained');
} finally { await rollbackDb.close(); }
console.log(`Shared orders/manual sync PostgreSQL checks passed: ${checks}`);
function reportWithReceived(){const r=report();r.orders[0].lines[0].status='received';return r;}
