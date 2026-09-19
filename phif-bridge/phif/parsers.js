function clean(text) {
  return String(text ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function rowsFromFirstTable(html) {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
  return [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((row) => (
    [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]))
  )).filter((row) => row.length);
}

export function parseTodayTransactions(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => {
    const action = String(row.action ?? row.Action ?? "");
    const invoiceKey = attr(action, "data-inv_id")
      || attr(action, "data-inv-id")
      || attr(action, "data-id")
      || action.match(/\/getTransaction\/([^"'\s<>]+)/i)?.[1]
      || null;
    const invoiceNumber = textValue(row.invoiceId ?? row.invoice_id ?? row.invoiceNumber ?? row.invoice_number);
    const cardNumber = textValue(row.beneficiaryCode ?? row.beneficiary_code ?? row.card_number);
    const beneficiaryName = textValue(row.beneficiaryName ?? row.beneficiary_name);
    return {
      invoice_number: invoiceNumber,
      card_number: cardNumber,
      beneficiary_name: beneficiaryName,
      status: textValue(row.status),
      invoice_key: invoiceKey || invoiceNumber,
    };
  }).filter((row) => row.invoice_number && row.card_number && row.invoice_key);
}

export function parseInvoiceDetails(html, fallbackInvoiceKey = null) {
  const headerText = clean(html);
  const invoiceNumber = headerText.match(/(?:رقم الفاتورة|invoice\s*(?:number|no\.?))\s*:?\s*([^\s]+)/i)?.[1] ?? null;
  const beneficiaryLine = headerText.match(/(?:المنتفع|beneficiary)\s*:?\s*([^-]+)-\s*([0-9]+)/i);
  const date = headerText.match(/(?:التاريخ|date)\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  const time = headerText.match(/(?:الوقت|time)\s*:?\s*(\d{2}:\d{2}(?::\d{2})?)/i)?.[1] ?? null;

  const tableRows = rowsFromFirstTable(html);
  const itemRows = tableRows.filter((row) => row.length >= 8 && !looksLikeHeader(row) && !row.join(" ").includes("المجموع"));
  const items = itemRows.map((row) => {
    const [supplier, active, strength, brand, quantity, insurance, outside, total] = row;
    return {
      invoice_key: fallbackInvoiceKey,
      supplier,
      source_classification: classifySource(supplier),
      active_ingredient: active,
      strength,
      brand,
      quantity: parseNumber(quantity),
      financial_fields: {
        insurance_amount: parseMoney(insurance),
        outside_insurance_amount: parseMoney(outside),
        total_amount: parseMoney(total),
      },
    };
  });

  return {
    invoice_number: invoiceNumber,
    card_number: beneficiaryLine?.[2] ?? null,
    beneficiary_name: beneficiaryLine?.[1]?.trim() ?? null,
    dispensing_date: date,
    dispensing_time: normalizeTime(time),
    items,
  };
}

export function classifySource(supplier) {
  const text = String(supplier ?? "").toLowerCase();
  if (!text.trim()) return "unknown";
  if (text.includes("phif") || text.includes("الصندوق")) return "phif-supplier";
  return "actual-supplier";
}

function normalizeTime(raw) {
  if (!raw) return null;
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${(match[3] ?? "00").padStart(2, "0")}`;
}

function parseMoney(value) {
  return parseNumber(String(value || "").replace("د.ل", ""));
}

function looksLikeHeader(row) {
  const joined = row.join(" ").toLowerCase();
  return row.some((cell) => /اسم|الدواء|المورد|الفات|التأمين|المشترك|الحالة|عرض|medicine|supplier|invoice|status|name/i.test(cell))
    || joined.includes("جار");
}

function textValue(value) {
  return clean(String(value ?? ""));
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

