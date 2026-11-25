// Minimal, sanitized transcription of the supplied order tables. No page scripts,
// account links, tokens, forms or receipt URLs are retained.
const received = "تم الاستلام بنجاح";
const ready = "تم تسليم المورد (جاهز للاستلام)";
const delivery = "قيد التوصيل (في انتظار تسليم المورد)";
const diwan = "شركة الديوان لاستيراد الأدوية والمستحضرات الطبية ومستلزمات الأم والطفل";
const expertise = "شركة الخبرات الدوائية لاستراد الأدوية";
const sifax = "شركة سيفاكس لاستيراد الأدوية والمعدات الطبية ومستلزمات الأم والطفل";
const rows = [
  [66256, "ASA ZADA / TABS / 100MG", "TG01", 2751, diwan, received, "2026-11-15 10:22 AM", 45, 45, "2026-11-25 01:05 AM"],
  [66257, "ATENZIO A / TABS / 5MG/160MG", "TG05", 2753, diwan, received, "2026-11-15 10:22 AM", 60, 60, "2026-11-17 04:54 PM"],
  [66258, "ِATOR 20 mg / TABS / 20MG", "26T0242", 2743, "شركة الوقاية", "قيد الانتظار", "-", 300, 300, ""],
  [66259, "CANDESARTAN PLUS / TABS / 8MG/12.5MG", "25213", 2721, "شركة الأصدقاء لاستيراد االأدوية", delivery, "2026-11-12 02:51 PM", 30, 30, ""],
  [66260, "Enalapril / TABS / 5MG", "409008", 2355, "شركة الفجر الدولية", delivery, "2026-11-12 08:37 PM", 30, 0, ""],
  [66261, "sitavitae plus / TABS / 50/1000MG", "SMB259", 2199, "الشركة الشاملة", ready, "2026-11-16 11:54 AM", 400, 400, "سلم بتاريخ: 2026-11-22 12:45 PM"],
  ...[[66262,"26068",2707,200], [66263,"26049",2708,0], [66264,"26055",2709,0],
    [66265,"26074",2710,0], [66266,"26070",2711,0], [66267,"26050",2712,0], [66268,"26051",2713,0]]
    .map(([id,batch,batchId,qty]) => [id,"SITAGLIMET 50MG/1000MG / TABS / 50/1000MG",batch,batchId,expertise,ready,"2026-11-12 02:41 PM",200,qty,"سلم بتاريخ: 2026-11-22 09:33 AM"]),
  [66269, "SITANORM PLUS / TABS / 50/500MG", "TH13", 2736, diwan, received, "2026-11-15 10:22 AM", 30, 30, "2026-11-25 01:05 AM"],
  [66270, "Ronumet / TABS / 50/850MG", "25GT0840", 2477, sifax, delivery, "2026-11-16 11:09 AM", 40, 0, ""],
  [66271, "Ronumet / TABS / 50/850MG", "25GT0841", 2478, sifax, delivery, "2026-11-16 11:09 AM", 40, 40, ""],
  [66698, "torvacol / TABS / 20MG", "2603043", 2726, "شركة الخبرة العالمية", delivery, "2026-11-15 12:14 PM", 300, 300, ""],
];
export const order10972Html = rows.map(([id,name,batch,batchId,supplier,state,approved,requested,qty,date]) => `
<table class="table table-bordered table-hover"><thead><tr>
<th>الدواء</th><th>Batch Number</th><th>المورد</th><th>حالة الصنف</th>
<th>تاريخ موافقة المورد</th><th>الكمية المطلوبة</th><th>الكمية المحددة من المورد</th><th>الإجراء</th>
</tr></thead><tbody><tr><td><div id="med_container_${id}">
${state === ready ? `<input name="orderBrand[]" type="checkbox" value="${id}"><label>${name}</label>` : `<h5>${name}</h5>`}
</div></td><td><strong>${batch}</strong><input disabled hidden name="Batch_id[]" id="batch_${id}" value="${batchId}"></td>
<td>${supplier}</td><td><div id="status_container_${id}"><span class="badge">${state}</span>${date ? `<br><small>${date}</small>` : ""}</div></td>
<td>${approved}</td><td><strong>${requested}</strong></td><td><input name="supplier_qunttity[]" value="${qty}" disabled id="qun_${id}"></td>
<td id="action_container_${id}">${state === received ? "تم الاستلام" : ""}</td></tr></tbody></table>`).join("\n");
