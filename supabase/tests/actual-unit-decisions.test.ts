// Run against a temporary in-memory PostgreSQL only. No connection string is accepted.
// Set PHIF_TEST_PGLITE_MODULE to an installed @electric-sql/pglite/dist/index.js.
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { actualUnitSourceSignature, actualStockUnitSignature, actualCostUnits, applyActualUnitDecisions } from "../../src/lib/actual-units.helpers";
import { actualImportedSnapshot, actualPricingSnapshot, actualUnitPreview, actualDecisionInput } from "../../src/lib/actual-units.preview";
import { calculateActualGrossMargin } from "../../src/lib/phif-stock.helpers";

const modulePath = process.env.PHIF_TEST_PGLITE_MODULE;
const integration = modulePath ? describe : describe.skip;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

integration("Actual unit migration in isolated PostgreSQL", () => {
  let db: any;
  beforeAll(async () => {
    const { PGlite } = await import(modulePath!);
    db = new PGlite(); // No data directory or network connection: memory only.
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.pharmacies(id uuid PRIMARY KEY,name text);
      CREATE TABLE public.pharmacy_users(id uuid PRIMARY KEY,pharmacy_id uuid,display_name text,role text,is_active boolean);
      CREATE TABLE public.phif_invoices(id uuid PRIMARY KEY,pharmacy_id uuid);
      CREATE TABLE public.phif_invoice_items(id uuid PRIMARY KEY,phif_invoice_id uuid,brand text,strength text,
        quantity numeric,metadata jsonb NOT NULL DEFAULT '{}',source_classification text);
      CREATE TABLE public.phif_stock_items(id uuid PRIMARY KEY,pharmacy_id uuid,source_stock_id text,brand_product_id text,
        brand_name text,strength text,dosage_unit text,package_quantity numeric,strips_quantity numeric,cost_price numeric,is_current boolean);
      CREATE TABLE public.phif_actual_stock_links(pharmacy_id uuid,phif_invoice_item_id uuid,version integer,is_active boolean);
      CREATE TABLE public.user_operation_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pharmacy_id uuid,user_id uuid,
        action text,entity text,entity_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());
      INSERT INTO public.pharmacies VALUES ('${id(1)}','صيدلية الترياق الشافي'),('${id(2)}','صيدلية الأندلس');
      INSERT INTO public.pharmacy_users VALUES ('${id(10)}','${id(1)}','Manager','admin',true),
        ('${id(11)}','${id(1)}','Employee','employee',true),('${id(12)}','${id(1)}','Inactive','admin',false),
        ('${id(13)}','${id(2)}','Other manager','admin',true);
      INSERT INTO public.phif_invoices VALUES ('${id(20)}','${id(1)}'),('${id(21)}','${id(1)}'),('${id(22)}','${id(2)}');
      INSERT INTO public.phif_invoice_items VALUES
        ('${id(30)}','${id(20)}','Aspirem EC','75MG',30,'{}','actual-supplier'),
        ('${id(31)}','${id(21)}','Aspirem EC','75MG',28,'{}','actual-supplier'),
        ('${id(32)}','${id(21)}','Aspirem EC','150MG',30,'{}','actual-supplier'),
        ('${id(33)}','${id(20)}','Apidra','100IU',1,'{}','actual-supplier'),
        ('${id(34)}','${id(20)}','TestVial','1MG',1,'{}','actual-supplier'),
        ('${id(35)}','${id(22)}','Aspirem EC','75MG',30,'{}','actual-supplier'),
        ('${id(36)}','${id(20)}','Aspirem EC','75MG',30,'{}','phif-supplier');
      INSERT INTO public.phif_stock_items VALUES
        ('${id(40)}','${id(1)}','tablet-source','tablet-product','Aspirem EC','75MG','TABS',56,4,0.563,true),
        ('${id(41)}','${id(1)}','pen-source','pen-product','Apidra','100IU','PEN',300,NULL,53.794,true),
        ('${id(42)}','${id(1)}','vial-source','vial-product','TestVial','1MG','VIAL',1,NULL,12,true),
        ('${id(43)}','${id(2)}','other-source','tablet-product','Aspirem EC','75MG','TABS',56,4,0.563,true);
      ALTER TABLE public.phif_invoice_items ADD COLUMN phif_financial_fields jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE public.phif_stock_items ADD COLUMN sale_price numeric;
    `);
    await db.exec(readFileSync("supabase/migrations/20261020020000_add_actual_unit_decisions.sql", "utf8"));
  }, 60000);
  beforeEach(async () => { await db.exec("RESET ROLE; TRUNCATE public.phif_actual_unit_decisions,public.user_operation_log,public.phif_actual_stock_links;"); });
  afterAll(async () => { await db?.close(); });

  async function entry(item = 30, stock = 40, version = 0) {
    const source = (await db.query("SELECT * FROM public.phif_invoice_items WHERE id=$1", [id(item)])).rows[0];
    const target = (await db.query("SELECT * FROM public.phif_stock_items WHERE id=$1", [id(stock)])).rows[0];
    return { item_id: source.id, stock_id: target.id, expected_version: version, expected_link_version: 0,
      imported: actualImportedSnapshot(source), pricing: actualPricingSnapshot(target),
      source_signature: actualUnitSourceSignature(source), stock_signature: actualStockUnitSignature(target) };
  }
  async function save(rows: any[], options: any = {}) {
    await db.exec(`SET ROLE ${options.role ?? "service_role"}`);
    try {
      return await db.query("SELECT public.set_phif_actual_units($1,$2,$3,$4::jsonb,$5,$6,$7) AS affected", [
        options.pharmacy ?? id(1), options.user === undefined ? id(10) : options.user, options.actor ?? "Manager",
        JSON.stringify(rows), options.unit ?? "tablet", options.cost ?? "tablet", options.revoke ?? false,
      ]);
    } finally { await db.exec("RESET ROLE"); }
  }
  const count = async (table: string) => Number((await db.query(`SELECT count(*) AS n FROM public.${table}`)).rows[0].n);

  it("blocks NULL/employee/inactive/cross-pharmacy actors and public RPC calls", async () => {
    const row = await entry();
    for (const options of [{ user: null }, { user: id(11), actor: "Employee" }, { user: id(12), actor: "Inactive" },
      { user: id(13), actor: "Other manager" }, { actor: "Forged name" }, { pharmacy: id(2) }, { role: "anon" }, { role: "authenticated" }]) {
      await expect(save([row], options)).rejects.toThrow();
    }
    expect(await count("phif_actual_unit_decisions")).toBe(0);
    expect(await count("user_operation_log")).toBe(0);
    await db.exec("SET ROLE service_role");
    try { await expect(db.query("UPDATE public.phif_actual_unit_decisions SET is_active=false")).rejects.toThrow(); }
    finally { await db.exec("RESET ROLE"); }
  });

  it("saves canonical DB-generated signatures, preserves imports, and audits edits/revocation atomically", async () => {
    const before = (await db.query("SELECT * FROM public.phif_invoice_items ORDER BY id")).rows;
    const stockBefore = (await db.query("SELECT * FROM public.phif_stock_items ORDER BY id")).rows;
    const row = await entry();
    expect((await save([row])).rows[0].affected).toBe(1);
    const saved = (await db.query("SELECT * FROM public.phif_actual_unit_decisions")).rows[0];
    expect(saved.updated_by).toBe(id(10)); expect(saved.updated_actor).toBe("Manager");
    const target = (await db.query("SELECT * FROM public.phif_stock_items WHERE id=$1", [id(40)])).rows[0];
    expect(actualCostUnits({ ...before[0], actual_unit_decision: saved }, target).issue).toBeNull();
    expect((await save([await entry(30,40,1)], { unit: "strip" })).rows[0].affected).toBe(1);
    await expect(save([row])).rejects.toThrow("Decision changed");
    expect((await save([await entry(30,40,2)], { revoke: true })).rows[0].affected).toBe(1);
    expect((await db.query("SELECT is_active,version FROM public.phif_actual_unit_decisions")).rows[0]).toEqual({ is_active: false, version: 3 });
    expect(await count("user_operation_log")).toBe(3);
    expect((await db.query("SELECT * FROM public.phif_invoice_items ORDER BY id")).rows).toEqual(before);
    expect((await db.query("SELECT * FROM public.phif_stock_items ORDER BY id")).rows).toEqual(stockBefore);
  });

  it("enforces tablet/pen/vial price units and refuses a 300-pen box conversion", async () => {
    for (const [item,stock,unit] of [[30,40,"tablet"],[33,41,"pen"],[34,42,"vial"]] as const) {
      expect((await save([await entry(item,stock)], { unit, cost: unit })).rows[0].affected).toBe(1);
    }
    await expect(save([await entry(30,40,1)], { cost: "box" })).rejects.toThrow("Unverified cost unit");
    await expect(save([await entry(33,41,1)], { unit: "tablet", cost: "tablet" })).rejects.toThrow("Unverified cost unit");
    await expect(save([await entry(33,41,1)], { unit: "box", cost: "pen" })).rejects.toThrow("Undocumented conversion");
  });

  it("rejects missing/forged snapshots, signatures and versions rather than SQL-NULL bypasses", async () => {
    const row = await entry();
    for (const field of ["imported","pricing","source_signature","stock_signature","expected_version","expected_link_version"]) {
      const missing: any = { ...row }; delete missing[field];
      await expect(save([missing])).rejects.toThrow();
    }
    for (const bad of [{ ...row, source_signature: "{}" }, { ...row, stock_signature: "{}" },
      { ...row, imported: { ...row.imported, quantity: 300 } }, { ...row, pricing: null }]) {
      await expect(save([bad])).rejects.toThrow();
    }
    expect(await count("phif_actual_unit_decisions")).toBe(0);
  });

  it("supports selected-item exceptions but rolls back mixed identities, sources and stock targets", async () => {
    const first = await entry(), second = await entry(31);
    await expect(save([first, first])).rejects.toThrow("Duplicate");
    expect((await save([second])).rows[0].affected).toBe(1); // First invoice explicitly excluded.
    expect((await db.query("SELECT phif_invoice_item_id FROM public.phif_actual_unit_decisions")).rows).toEqual([{ phif_invoice_item_id: id(31) }]);
    for (const incompatible of [await entry(32), await entry(33,41), await entry(35), await entry(36), await entry(30,43)]) {
      await expect(save([first, incompatible])).rejects.toThrow();
    }
    expect(await count("phif_actual_unit_decisions")).toBe(1);
    expect(await count("user_operation_log")).toBe(1);
    expect((await save([first, await entry(31,40,1)])).rows[0].affected).toBe(2);
    expect(await count("phif_actual_unit_decisions")).toBe(2);
    expect((await save([await entry(30,40,1)], { revoke: true })).rows[0].affected).toBe(1);
    expect((await db.query("SELECT phif_invoice_item_id,is_active FROM public.phif_actual_unit_decisions ORDER BY phif_invoice_item_id")).rows)
      .toEqual([{ phif_invoice_item_id: id(30), is_active: false }, { phif_invoice_item_id: id(31), is_active: true }]);
  });

  it("rejects changed manual links and rolls back decisions if audit insertion fails", async () => {
    await db.query("INSERT INTO public.phif_actual_stock_links VALUES ($1,$2,1,true)", [id(1),id(30)]);
    const row = await entry();
    await expect(save([row])).rejects.toThrow("Stock link changed");
    row.expected_link_version = 1;
    await db.exec("ALTER TABLE public.user_operation_log ADD CONSTRAINT test_audit_failure CHECK(false)");
    try { await expect(save([row])).rejects.toThrow(); }
    finally { await db.exec("ALTER TABLE public.user_operation_log DROP CONSTRAINT test_audit_failure"); }
    expect(await count("phif_actual_unit_decisions")).toBe(0);
  });

  it("binds financial unit evidence and never overrides a trusted quantity unit", async () => {
    const stale = await entry();
    await db.query("UPDATE public.phif_invoice_items SET phif_financial_fields=$1::jsonb WHERE id=$2", [JSON.stringify({ quantity_unit: "TABLETS" }),id(30)]);
    try {
      await expect(save([stale])).rejects.toThrow("signature");
      const documented = await entry();
      await expect(save([documented], { unit: "box" })).rejects.toThrow("Conflicting source quantity unit");
      expect((await save([documented])).rows[0].affected).toBe(1);
    } finally { await db.query("UPDATE public.phif_invoice_items SET phif_financial_fields='{}' WHERE id=$1", [id(30)]); }
  });

  it("runs suggested subset approval through the real RPC, reloads, edits and revokes without altering imports", async () => {
    await db.query(`INSERT INTO public.phif_stock_items(id,pharmacy_id,source_stock_id,brand_product_id,brand_name,strength,
      dosage_unit,package_quantity,strips_quantity,cost_price,sale_price,is_current)
      VALUES ($1,$2,'prostam-source','prostam-product','PROSTAM LP','400 MCG','CAPS',30,2,3.6,4.32,true)`, [id(140), id(1)]);
    await db.query(`INSERT INTO public.phif_invoice_items(id,phif_invoice_id,brand,strength,quantity,source_classification,phif_financial_fields)
      VALUES ($1,$3,'PROSTAM LP','400 MCG',30,'actual-supplier','{"total_amount":129.6}'),
      ($2,$3,'PROSTAM LP','400 MCG',30,'actual-supplier','{"total_amount":120}')`, [id(130), id(131), id(20)]);
    try {
      const items = (await db.query("SELECT * FROM public.phif_invoice_items WHERE id IN ($1,$2) ORDER BY id", [id(130), id(131)])).rows;
      const stocks = (await db.query("SELECT * FROM public.phif_stock_items WHERE id=$1", [id(140)])).rows;
      const before = JSON.stringify(items), stockBefore = JSON.stringify(stocks);
      const preview = actualUnitPreview({ invoices: [{ id: id(20) }], items, stocks, decisions: [], scope: { itemId: id(130) } });
      const compatible = preview.rows.filter(row => row.suggestion.status === "high_confidence");
      expect(compatible).toHaveLength(1);
      const selected = actualDecisionInput(preview, { rows: compatible.map(row => ({ ...row, priceSignature: row.suggestion.priceSignature })),
        dispensingUnit: "capsule", costUnit: "capsule", revoke: false, suggestedOnly: true });
      expect((await save([await entry(130,140)], { unit: "capsule", cost: "capsule" })).rows[0].affected).toBe(selected.length);
      const reloaded = async () => applyActualUnitDecisions(items, (await db.query("SELECT * FROM public.phif_actual_unit_decisions")).rows);
      const [bound, excluded] = await reloaded();
      expect(calculateActualGrossMargin(bound, stocks).purchaseCost).toBe(108);
      expect(calculateActualGrossMargin(bound, stocks).grossMargin).toBeCloseTo(21.6);
      expect(calculateActualGrossMargin(excluded, stocks).purchaseCost).toBeNull();
      await save([await entry(130,140,1)], { unit: "strip", cost: "capsule" });
      expect(calculateActualGrossMargin((await reloaded())[0], stocks).purchaseCost).toBe(1620);
      await save([await entry(130,140,2)], { unit: "capsule", cost: "capsule", revoke: true });
      expect(calculateActualGrossMargin((await reloaded())[0], stocks).purchaseCost).toBeNull();
      expect(JSON.stringify((await db.query("SELECT * FROM public.phif_invoice_items WHERE id IN ($1,$2) ORDER BY id", [id(130),id(131)])).rows)).toBe(before);
      expect(JSON.stringify((await db.query("SELECT * FROM public.phif_stock_items WHERE id=$1", [id(140)])).rows)).toBe(stockBefore);
      expect(await count("user_operation_log")).toBe(3);
    } finally {
      await db.query("DELETE FROM public.phif_actual_unit_decisions WHERE phif_invoice_item_id IN ($1,$2)", [id(130),id(131)]);
      await db.query("DELETE FROM public.phif_invoice_items WHERE id IN ($1,$2)", [id(130),id(131)]);
      await db.query("DELETE FROM public.phif_stock_items WHERE id=$1", [id(140)]);
    }
  });
});
