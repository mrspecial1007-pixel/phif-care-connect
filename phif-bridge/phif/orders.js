import { parse } from "node-html-parser";
import { randomUUID } from "node:crypto";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const layoutCodes = new Map([
  ["PHIF order detail layout was not recognized", "layout_unrecognized"],
  ["PHIF order detail columns were not recognized", "columns_unrecognized"],
  ["Incomplete PHIF order line", "incomplete_line"],
  ["PHIF order line identity is missing", "line_identity_missing"],
  ["PHIF order medicine is missing", "medicine_missing"],
  ["Duplicate PHIF order line identity", "duplicate_line"],
]);
const fail = message => { throw Object.assign(new Error(message), { orderErrorCode: layoutCodes.get(message) || "validation" }); };
const transportCodes = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
function failureType(error, signal) {
  if (signal?.aborted) return "cancelled";
  if (layoutCodes.has(error?.message) && error?.orderErrorCode === layoutCodes.get(error.message)) return error.orderErrorCode;
  if (error?.name === "TimeoutError" || error?.code === "PHIF_UPSTREAM_TIMEOUT") return "timeout";
  if (error?.code === "PHIF_UPSTREAM_PROTOCOL_ERROR") return "protocol";
  if (error?.code === "PHIF_UPSTREAM_CONNECTION_ERROR") return "connection";
  if (error?.name === "AbortError") return "aborted";
  if (transportCodes.has(error?.code) || transportCodes.has(error?.cause?.code)) return "temporary_transport";
  return "unexpected";
}
const decimal = value => {
  const text = clean(value);
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
};

// PHIF displays local Libya wall-clock times (the application's Africa/Tripoli zone).
function detailDate(value) {
  const match = /^(?:سلم بتاريخ: )?(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) (AM|PM)$/.exec(clean(value));
  if (!match) return null;
  const [, day, hour, minute, period] = match;
  if (+hour < 1 || +hour > 12 || +minute > 59) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day) return null;
  const localHour = (+hour % 12) + (period === "PM" ? 12 : 0);
  return new Date(`${day}T${String(localHour).padStart(2, "0")}:${minute}:00+02:00`).toISOString();
}

function modernLine(cells, headers) {
  const cell = label => cells[headers.indexOf(label)];
  const med = cell("الدواء")?.querySelector('[id^="med_container_"]');
  const state = cell("حالة الصنف")?.querySelector('[id^="status_container_"]');
  const input = cell("الكمية المحددة من المورد")?.querySelector('input[name="supplier_qunttity[]"]');
  const id = /^med_container_(\d+)$/.exec(med?.getAttribute("id") || "")?.[1];
  if (!id || state?.getAttribute("id") !== `status_container_${id}` || !input
    || (input.getAttribute("id") && input.getAttribute("id") !== `qun_${id}`))
    fail("PHIF order line identity is missing");
  const approval = clean(state.querySelector(".badge")?.textContent);
  const actionText = clean(cell("الإجراء")?.textContent);
  const stage = new Map([
    ["تم الاستلام بنجاح", "received"],
    ["تم تسليم المورد (جاهز للاستلام)", "ready"],
    ["قيد التوصيل (في انتظار تسليم المورد)", "in_delivery"],
    ["قيد الانتظار", "not_approved"],
  ]).get(approval) || "review";
  if (actionText === "تم الاستلام" && stage !== "received") fail("Incomplete PHIF order line");
  const accepted = ["received", "ready", "in_delivery"].includes(stage);
  const quantity = decimal(input.getAttribute("value"));
  const batchInput = cell("Batch Number")?.querySelector('input[name="Batch_id[]"]');
  const batchId = batchInput?.getAttribute("value") || null;
  if (!batchId || !/^\d+$/.test(batchId)) fail("PHIF order line identity is missing");
  return {
    id, medicine: clean(med.querySelector("h5,label")?.textContent),
    batch: clean(cell("Batch Number")?.querySelector("strong")?.textContent) || null,
    batchId, supplier: clean(cell("المورد")?.textContent) || null, approval,
    requestedQuantity: decimal(cell("الكمية المطلوبة")?.textContent),
    supplierQuantity: quantity, approvedQuantity: accepted ? quantity : null,
    // The supplier field is not evidence of an independently measured received quantity.
    receivedQuantity: null, quantityMissing: accepted && quantity == null,
    status: stage === "ready" || stage === "in_delivery" ? "waiting" : stage,
    fulfillmentStage: stage,
    approvedAt: accepted ? detailDate(cell("تاريخ موافقة المورد")?.textContent) : null,
    receivedAt: stage === "received" ? detailDate(state.querySelector("small")?.textContent) : null,
    deliveredAt: stage === "ready" ? detailDate(state.querySelector("small")?.textContent) : null,
  };
}

// These fields and table labels were observed in PHIF, not inferred from stock/invoices.
export function parsePhifOrderDetails(html) {
  const document = parse(html);
  const tables = document.querySelectorAll("table");
  if (!tables.length && !document.textContent.includes("قم بتحديد كميات الادوية"))
    fail("PHIF order detail layout was not recognized");
  const lines = new Map();
  for (const table of tables) {
    const before = lines.size;
    const rows = table.querySelectorAll("tr");
    const headers = rows[0]?.querySelectorAll("th,td").map(cell => clean(cell.textContent)) || [];
    const index = label => headers.indexOf(label);
    if (index("الدواء") < 0 || index("الكمية المحددة من المورد") < 0)
      fail("PHIF order detail columns were not recognized");
    for (const row of rows.slice(1)) {
      const cells = row.querySelectorAll("td");
      if (!cells.length) continue;
      if (cells.length !== headers.length) fail("Incomplete PHIF order line");
      if (index("حالة الصنف") >= 0) {
        if (["Batch Number", "المورد", "تاريخ موافقة المورد", "الكمية المطلوبة", "الإجراء"].some(label => index(label) < 0))
          fail("PHIF order detail columns were not recognized");
        const line = modernLine(cells, headers);
        if (!line.medicine) fail("PHIF order medicine is missing");
        if (lines.has(line.id)) fail("Duplicate PHIF order line identity");
        lines.set(line.id, line);
        continue;
      }
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
    if (index("حالة الصنف") >= 0 && lines.size === before) fail("Incomplete PHIF order line");
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
  const runId = randomUUID(), startedAt = Date.now();
  const log = (order, stage, event, attempt, type, status) => {
    try {
      console.info("phif_order_details", { runId, orderId: order.id,
        orderNumber: /^(?:\d+|ORD_\d+(?:_\d+)+)$/.test(order.number) ? order.number : order.id,
        stage, event, attempt, elapsedMs: Date.now() - startedAt,
        ...(type ? { type } : {}), ...(Number.isInteger(status) && status >= 0 && status <= 599 ? { status } : {}) });
    } catch { /* Diagnostics must not affect snapshot completeness. */ }
  };
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
      let stage = "fetch", attempt = 0;
      try {
        let response;
        for (attempt = 1; attempt <= 2; attempt++) {
          checkDeadline();
          client.signal?.throwIfAborted();
          log(order, stage, "started", attempt);
          let retryType;
          try {
            response = await client.getHtml(`/show-pharmacy-order/${order.id}`);
            log(order, stage, "finished", attempt, undefined, response.status);
            if (response.ok) break;
            const type = response.authRequired ? "authentication" : response.blocked ? "blocked"
              : [408, 429, 502, 503, 504].includes(response.status) ? "temporary_http" : "http";
            log(order, stage, "failed", attempt, type, response.status);
            if (type !== "temporary_http") throw Object.assign(new Error("detail_read_failed"), { alreadyLogged: true });
            retryType = type;
          } catch (error) {
            if (error?.alreadyLogged) throw error;
            const type = failureType(error, client.signal);
            log(order, stage, "failed", attempt, type);
            if (!["timeout", "temporary_transport"].includes(type)) throw Object.assign(new Error("detail_read_failed"), { alreadyLogged: true });
            retryType = type;
          }
          // One retry, only for an identified transient failure; never for changed HTML or login.
          if (attempt === 2 || deadline - Date.now() < (client.timeoutMs || 15000) + 250)
            throw Object.assign(new Error("detail_read_failed"), { alreadyLogged: true });
          log(order, stage, "retry", attempt, retryType);
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        client.signal?.throwIfAborted();
        stage = "parse_validate";
        log(order, stage, "started", attempt);
        order.lines = parsePhifOrderDetails(response.text);
        log(order, stage, "finished", attempt);
        order.detailError = null;
        log(order, "complete", "finished", attempt);
      } catch (error) {
        if (!error?.alreadyLogged) log(order, stage, "failed", attempt, failureType(error, client.signal));
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
