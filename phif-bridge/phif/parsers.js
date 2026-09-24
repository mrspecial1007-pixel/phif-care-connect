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

function itemRowsFromInvoiceTables(html) {
  const tables = [...String(html ?? "").matchAll(/<table[\s\S]*?<\/table>/gi)];
  const rows = [];
  for (const tableMatch of tables) {
    const tableHtml = tableMatch[0];
    const beforeTable = String(html).slice(Math.max(0, tableMatch.index - 180), tableMatch.index);
    const tableSource = classifySource(`${clean(beforeTable)} ${clean(tableHtml.match(/<caption[\s\S]*?<\/caption>/i)?.[0] ?? "")}`);
    for (const rowMatch of tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]));
      if (cells.length < 6 || looksLikeHeader(cells) || cells.join(" ").includes("ط§ظ„ظ…ط¬ظ…ظˆط¹")) continue;
      const row = cells.length >= 8
        ? {
            supplier: cells[0],
            active: cells[1],
            strength: cells[2],
            brand: cells[3],
            quantity: cells[4],
            insurance: cells[5],
            outside: cells[6],
            total: cells[7],
          }
        : {
            supplier: tableSource === "phif-supplier" ? "PHIF Supplier" : "Actual Supplier",
            active: cells[0],
            strength: cells[1],
            brand: cells[2],
            quantity: cells[3],
            insurance: cells[4],
            outside: cells.length >= 7 ? cells[5] : null,
            total: cells.length >= 7 ? cells[6] : cells[5],
          };
      if (!row.active && !row.brand) continue;
      rows.push(row);
    }
  }
  return rows;
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

export function parseFilterTransactionForm(html) {
  const forms = [...String(html ?? "").matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((match) => match[0]);
  const form = forms.find((candidate) => /name\s*=\s*["']dateFrom["']/i.test(candidate) && /name\s*=\s*["']dateTo["']/i.test(candidate))
    ?? forms.find((candidate) => /showPharmacyFilterTransactions/i.test(candidate))
    ?? forms[0]
    ?? "";
  const controls = [...form.matchAll(/<(input|select|textarea)\b[\s\S]*?>/gi)].map((match) => {
    const tag = match[1].toLowerCase();
    const raw = match[0];
    return {
      tag,
      name: attr(raw, "name"),
      type: attr(raw, "type") || (tag === "select" ? "select" : tag),
      value: attr(raw, "value"),
      placeholder: attr(raw, "placeholder"),
      min: attr(raw, "min"),
      max: attr(raw, "max"),
    };
  }).filter((control) => control.name);

  return {
    action: attr(form, "action") || "/showPharmacyFilterTransactions",
    method: (attr(form, "method") || "GET").toUpperCase(),
    controls,
    hidden_fields: Object.fromEntries(
      controls
        .filter((control) => String(control.type).toLowerCase() === "hidden" && control.name)
        .map((control) => [control.name, control.value ?? ""]),
    ),
  };
}

export function parseHistoricalTransactions(payload) {
  if (typeof payload !== "string") return parseTodayTransactions(payload);
  const text = payload.trim();
  if (!text) return [];
  try {
    return parseTodayTransactions(JSON.parse(text));
  } catch {
    return parseTransactionTableHtml(text);
  }
}

export function parseTransactionTableHtml(html) {
  const tableRows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  return tableRows.map((rowMatch) => {
    const rowHtml = rowMatch[0];
    if (!/data-inv_id|data-inv-id|\/getTransaction\//i.test(rowHtml)) return null;
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]));
    const invoiceKey = attr(rowHtml, "data-inv_id")
      || attr(rowHtml, "data-inv-id")
      || rowHtml.match(/\/getTransaction\/([^"'\s<>]+)/i)?.[1]
      || null;
    const meaningful = cells.filter(Boolean);
    const invoiceNumber = meaningful.find((cell) => /\d/.test(cell)) ?? null;
    const cardNumber = meaningful.find((cell) => /^\d{10,}$/.test(cell.replace(/\s+/g, ""))) ?? null;
    const beneficiaryName = meaningful.find((cell) => /[\u0600-\u06FFA-Za-z]/.test(cell) && !/عرض|view|ط§ظ„/.test(cell)) ?? null;
    return {
      invoice_number: invoiceNumber,
      card_number: cardNumber,
      beneficiary_name: beneficiaryName,
      status: null,
      invoice_key: invoiceKey || invoiceNumber,
      cells: meaningful,
    };
  }).filter((row) => row?.invoice_key);
}

export function parseInvoiceDetails(html, fallbackInvoiceKey = null) {
  const headerText = clean(html);
  const invoiceNumber = headerText.match(/(?:رقم الفاتورة|invoice\s*(?:number|no\.?))\s*:?\s*([^\s]+)/i)?.[1] ?? null;
  const beneficiaryLine = headerText.match(/(?:المنتفع|beneficiary)\s*:?\s*([^-]+)-\s*([0-9]+)/i);
  const date = headerText.match(/(?:التاريخ|date)\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  const time = headerText.match(/(?:الوقت|time)\s*:?\s*(\d{2}:\d{2}(?::\d{2})?)/i)?.[1] ?? null;

  const items = itemRowsFromInvoiceTables(html).map((row) => ({
    invoice_key: fallbackInvoiceKey,
    supplier: row.supplier,
    source_classification: classifySource(row.supplier),
    active_ingredient: row.active,
    strength: row.strength,
    brand: row.brand,
    quantity: parseNumber(row.quantity),
    financial_fields: {
      insurance_amount: parseMoney(row.insurance),
      outside_insurance_amount: parseMoney(row.outside),
      total_amount: parseMoney(row.total),
    },
  }));

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
  const headerHits = row.filter((cell) => (
    /اسم|الدواء|المورد|الفات|التأمين|المشترك|الحالة|عرض|medicine|supplier|invoice|status|name|active|ingredient|strength|brand|qty|quantity|insurance|outside|total/i.test(cell)
  )).length;
  return headerHits >= 2 || joined.includes("جار");
}

function textValue(value) {
  return clean(String(value ?? ""));
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}
