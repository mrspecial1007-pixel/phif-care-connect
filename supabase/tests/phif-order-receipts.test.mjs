// Memory-only PostgreSQL. No Cloud URL or connection is accepted.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PHIF_TEST_PGLITE_MODULE
  ? pathToFileURL(process.env.PHIF_TEST_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let checks = 0;
const check = (value, message) => { assert.ok(value,message); checks++; };
const deny = async fn => { await assert.rejects(fn); checks++; };
const report = (time, status='waiting') => ({ complete:true,totalOrders:1,fetchedAt:`2020-01-0${time}T00:00:00Z`,orders:[{
  id:'10',number:'ORD_10',createdAt:'2019-12-01T12:00:00Z',detailError:null,lines:[
    {id:'100',medicine:'Test tablet',batch:'0001',status},
    {id:'101',medicine:'Old received tablet',batch:'0002',status:'received'},
  ]}] });
async function rpc(sql, params, role='service_role') {
  await db.exec(`SET ROLE ${role}`);
  try { return await db.query(sql,params); } finally { await db.exec('RESET ROLE'); }
}
const observe = (r,actor=id(3),pharmacy=id(1),role) => rpc('SELECT observe_phif_order_receipts($1,$2,$3::jsonb)',[pharmacy,actor,JSON.stringify(r)],role);
const save = (date,version,actor=id(3),pharmacy=id(1),line='100',role) => rpc('SELECT set_phif_order_receipt_date($1,$2,$3,$4,$5::date,$6) AS saved',[pharmacy,actor,'10',line,date,version],role);
const row = async (line='100') => (await db.query('SELECT * FROM phif_order_receipts WHERE pharmacy_id=$1 AND line_id=$2',[id(1),line])).rows[0];
try {
  await db.exec(`CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE pharmacies(id uuid PRIMARY KEY,name text);
    CREATE TABLE pharmacy_users(id uuid PRIMARY KEY,pharmacy_id uuid,role text,is_active boolean,permissions jsonb DEFAULT '{}');
    CREATE TABLE user_operation_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pharmacy_id uuid,user_id uuid,action text,entity text,entity_id uuid,metadata jsonb);
    INSERT INTO pharmacies VALUES('${id(1)}','صيدلية الترياق الشافي'),('${id(2)}','صيدلية الأندلس');
    INSERT INTO pharmacy_users VALUES('${id(3)}','${id(1)}','admin',true,'{}'),('${id(4)}','${id(1)}','employee',true,'{"inventory_read":true}'),
      ('${id(5)}','${id(2)}','admin',true,'{}'),('${id(6)}','${id(1)}','admin',false,'{}');`);
  await db.exec(readFileSync(new URL('../migrations/20261025010000_add_phif_order_receipts.sql',import.meta.url),'utf8'));
  for (const actor of [null,id(5),id(6)]) await deny(()=>observe(report(1),actor));
  for (const role of ['anon','authenticated']) await deny(()=>observe(report(1),id(3),id(1),role));
  await observe(report(1));
  check((await row()).first_received_observed_at===null,'waiting has no observation');
  check((await row('101')).first_received_observed_at===null,'no invented observation for already received first baseline');
  await observe(report(2,'received'),id(4));
  const observed = await row();
  check(Boolean(observed.first_received_observed_at),'actual transition records server observation');
  check(observed.confirmed_received_on===null,'observation is not an actual date');
  check(observed.version===2,'status change checks versions');
  await observe(report(3,'received'));
  check((await row()).first_received_observed_at.getTime()===observed.first_received_observed_at.getTime(),'repeat sync retains first observation');
  for (const actor of [null,id(4),id(5),id(6)]) await deny(()=>save('2019-12-10',2,actor));
  await deny(()=>save('2019-12-10',2,id(3),id(2)));
  await deny(()=>save('2019-12-10',2,id(3),id(1),'999'));
  await deny(()=>save('2019-12-10',2,id(3),id(1),'100','anon'));
  await deny(()=>save('2019-11-30',2)); await deny(()=>save('2099-01-01',2)); await deny(()=>save('2019-12-10',1));
  const saved = (await save('2019-12-10',2)).rows[0].saved;
  check(saved.confirmed_received_on==='2019-12-10','manager saves exact manual date');
  check(saved.confirmed_by===id(3)&&saved.version===3,'actor and version saved');
  const repeat = (await save('2019-12-10',3)).rows[0].saved;
  check(repeat.version===3,'unchanged save does not write');
  await observe(report(4,'received'));
  check((await row()).confirmed_received_on.toISOString().slice(0,10)==='2019-12-10','sync never overwrites confirmed dates');
  await save('2019-12-11',3); await save(null,4);
  check((await row()).confirmed_received_on===null&&Boolean((await row()).first_received_observed_at),'revocation preserves original observation');
  const snapshot = JSON.stringify((await db.query('SELECT * FROM phif_order_receipts ORDER BY id')).rows);
  const partial=report(5);partial.complete=false;await deny(()=>observe(partial));
  const omitted=report(5);omitted.orders=[];omitted.totalOrders=0;await deny(()=>observe(omitted));
  const changed=report(5);changed.orders[0].lines[0].medicine='Other product';await deny(()=>observe(changed));
  const duplicate=report(5);duplicate.orders[0].lines[1].id='100';await deny(()=>observe(duplicate));
  check(JSON.stringify((await db.query('SELECT * FROM phif_order_receipts ORDER BY id')).rows)===snapshot,'failed/partial reads roll back atomically');
  const filtered=report(6,'received');filtered.orders[0].lines.pop();await observe(filtered);
  check(Boolean(await row('101'))&&JSON.stringify((await db.query('SELECT * FROM phif_order_receipts ORDER BY id')).rows)===snapshot,
    'a filtered zero/omitted line never deletes or resets its existing history');
  await deny(()=>observe(report(1,'waiting')));check((await row()).status==='received','stale read cannot reverse current state');
  await deny(()=>rpc("UPDATE phif_order_receipts SET confirmed_received_on='2019-12-15'",[]));
  await deny(()=>rpc('SELECT * FROM phif_order_receipts',[],'authenticated'));
  const logs=(await db.query("SELECT * FROM user_operation_log")).rows;
  check(logs.filter(l=>l.action==='order_receipt_first_observed').length===1,'first observation logged once');
  check(logs.filter(l=>l.action==='order_receipt_date').length===3,'manual save/edit/revoke audited');
  check(!(await db.query('SELECT * FROM phif_order_receipts WHERE pharmacy_id=$1',[id(2)])).rows.length,'other pharmacy untouched');
  console.log(`PHIF receipt PostgreSQL checks passed: ${checks}`);
} finally { await db.close(); }
