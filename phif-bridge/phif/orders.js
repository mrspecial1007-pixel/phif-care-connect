import { parse } from "node-html-parser";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const fail = message => { throw new Error(message); };
const decimal = value => {
  const text = clean(value);
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
};

// These fields and table labels were observed in PHIF, not inferred from stock/invoices.
export function parsePhifOrderDetails(html) {
  const document = parse(html);
  const tables = document.querySelectorAll("table");
  if (!tables.length && !document.textContent.includes("قم بتحديد كميات الادوية"))
    fail("PHIF order detail layout was not recognized");
  const lines = new Map();
  for (const table of tables) {
    const rows = table.querySelectorAll("tr");
    const headers = rows[0]?.querySelectorAll("th,td").map(cell => clean(cell.textContent)) || [];
    const index = label => headers.indexOf(label);
    if (index("الدواء") < 0 || index("الكمية المحددة من المورد") < 0)
      fail("PHIF order detail columns were not recognized");
    for (const row of rows.slice(1)) {
      const cells = row.querySelectorAll("td");
      if (!cells.length) continue;
      if (cells.length !== headers.length) fail("Incomplete PHIF order line");
      const input = cells[index("الكمية المحددة من المورد")]?.querySelector('input[id^="qun_"]');
      const id = /^qun_(\d+)$/.exec(input?.getAttribute("id") || "")?.[1];
      if (!id) fail("PHIF order line identity is missing");
      const text = label => clean(cells[index(label)]?.textContent);
      const approval = text("الحالة");
      const action = cells[index("الاجراء")];
      const received = clean(action?.textContent) === "تم الاستلام";
      // Inspect the receipt action only. Never request or return its URL to the app.
      const receiptAction = action?.querySelectorAll("a").some(a => {
        try {
          const url = new URL(a.getAttribute("href"), "https://his.phif.gov.ly");
          return ["http://his.phif.gov.ly", "https://his.phif.gov.ly"].includes(url.origin)
            && url.pathname === `/accept-pharmacy-order/${id}` && clean(a.textContent) === "استلام الطلب";
        } catch { return false; }
      });
      const quantity = decimal(input.getAttribute("value"));
      const accepted = approval === "تم القبول";
      const pending = ["قيد الاجراء", "قيد الإجراء", "في الانتظار"].includes(approval);
      const status = accepted && received ? "received" : accepted && receiptAction ? "waiting"
        : pending && !received && !receiptAction ? "not_approved" : "review";
      const line = {
        id, medicine: text("الدواء"), batch: text("Batch Number") || null,
        supplier: text("المورد") || null, approval,
        approvedQuantity: accepted ? quantity : null,
        status, quantityMissing: accepted && quantity == null,
        approvedAt: null, receivedAt: null,
      };
      if (!line.medicine) fail("PHIF order medicine is missing");
      if (lines.has(id)) fail("Duplicate PHIF order line identity");
      lines.set(id, line);
    }
  }
  return [...lines.values()];
}

function orderPage(payload) {
  if (!Array.isArray(payload?.data)) fail("Invalid PHIF order list response");
  const total = decimal(payload.recordsTotal), filtered = decimal(payload.recordsFiltered);
  if (!Number.isSafeInteger(total) || total > 50000 || filtered !== total)
    fail("PHIF order list total is missing, filtered or exceeds the safe read limit");
  return { rows: payload.data, total };
}

export async function readCompletePhifOrders(client, expectedSourcePharmacy, { budgetMs = 60000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const checkDeadline = () => { if (Date.now() >= deadline) fail("PHIF order read time budget exceeded; refresh required"); };
  if (!/^\d+$/.test(String(expectedSourcePharmacy || "")))
    fail("PHIF_TIRYAQ_SOURCE_PHARMACY_ID is not configured");
  const getJson = async path => {
    checkDeadline();
    const result = await client.getJson(path);
    if (!result.ok) fail(result.authRequired ? "PHIF login is required" : "PHIF order list could not be read");
    return orderPage(result.json);
  };
  const first = await getJson("/get-pharmacy-request-index");
  const orders = new Map(), branches = new Set();
  function append(rows) {
    for (const row of rows) {
      if (String(row.pharmacies_id) !== String(expectedSourcePharmacy))
        fail("PHIF orders do not belong to the configured source pharmacy");
      if (row.pharmacy_branch_id == null) fail("PHIF order branch identity is missing");
      branches.add(String(row.pharmacy_branch_id));
      if (branches.size !== 1) fail("PHIF order response mixes pharmacy branches");
      const id = String(row.id ?? "");
      if (!/^\d+$/.test(id)) fail("Invalid PHIF order identity");
      const order = {
        id, number: clean(row.order_id) || id,
        createdAt: /^\d{4}-\d{2}-\d{2}T/.test(String(row.created_at)) && Number.isFinite(Date.parse(row.created_at))
          ? new Date(row.created_at).toISOString() : null,
        status: clean(row.status),
      };
      const previous = orders.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(order)) fail("Conflicting PHIF order list rows");
      orders.set(id, order);
    }
  }
  append(first.rows);
  let offset = first.rows.length, pages = 1;
  while (orders.size < first.total) {
    if (!first.rows.length || pages >= 1000) fail("Incomplete PHIF order pagination");
    const page = await getJson(`/get-pharmacy-request-index?start=${offset}&length=100&draw=${pages + 1}`);
    if (page.total !== first.total) fail("PHIF order count changed during reading; refresh required");
    const before = orders.size;
    append(page.rows);
    if (orders.size === before) fail("PHIF order pagination made no progress");
    offset += page.rows.length;
    pages++;
  }
  if (orders.size !== first.total) fail("Incomplete PHIF order pagination");
  const result = [...orders.values()];
  let cursor = 0;
  // Bounded parallel reads, scoped to this call and this authenticated session only.
  await Promise.all(Array.from({ length: Math.min(3, result.length) }, async () => {
    while (cursor < result.length) {
      checkDeadline();
      const order = result[cursor++];
      try {
        const response = await client.getHtml(`/show-pharmacy-order/${order.id}`);
        if (!response.ok) throw new Error("detail_read_failed");
        order.lines = parsePhifOrderDetails(response.text);
        order.detailError = null;
      } catch {
        order.lines = [];
        order.detailError = "تعذر قراءة تفاصيل الطلب؛ لا تُعتبر أصنافه مستلمة أو صفرًا";
      }
    }
  }));
  const lineIds = new Set();
  for (const order of result) for (const line of order.lines) {
    if (lineIds.has(line.id)) fail("PHIF line identity appeared in multiple orders");
    lineIds.add(line.id);
  }
  const excludedZero = result.reduce((n, o) => n + o.lines.filter(l => l.approvedQuantity === 0).length, 0);
  for (const order of result) order.lines = order.lines.filter(line => line.approvedQuantity !== 0);
  return { orders: result, totalOrders: first.total, pages, excludedZero,
    complete: result.every(order => !order.detailError), fetchedAt: new Date().toISOString() };
}
