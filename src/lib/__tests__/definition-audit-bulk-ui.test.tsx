import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupplierUnitReviewRow, selectedSupplierProposals } from "@/components/management/DefinitionAuditBulkButton";

const row = { identity: "stable-id", name: "BECLOMETHASONE DIPROPIONATE 250 MCG", size: 1, baseUnit: "inhaler",
  unit: "inhaler", savedUnit: null, options: [{ unit: "inhaler" as const, boxes: 2 }], exceptionCount: 0, itemCount: 2, token: "signed" };
const plan = { ready: [row, { ...row, identity: "other" }], excluded: [], checkedAt: "2026-11-19T00:00:00Z" };

describe("bulk proposal review", () => {
  it("does not auto-select proposed or stored units; selects only reviewed, convertible identities", () => {
    const units = { "stable-id": "inhaler", other: "inhaler" };
    expect(selectedSupplierProposals(plan, {}, units)).toEqual([]);
    expect(selectedSupplierProposals(plan, { "stable-id": true }, units)).toEqual([row]);
    expect(selectedSupplierProposals(plan, { "stable-id": false, other: true }, units).map(r => r.identity)).toEqual(["other"]);
    expect(selectedSupplierProposals(plan, { "stable-id": true }, { "stable-id": "vial" })).toEqual([]);
    expect(selectedSupplierProposals(null, {}, {})).toEqual([]);
  });
  it("shows an unsaved proposal, box reference and conversion separately; review is unchecked", () => {
    const html = renderToStaticMarkup(<SupplierUnitReviewRow row={row} unit="inhaler" reviewed={false}
      disabled={false} onUnit={() => {}} onReviewed={() => {}} />);
    expect(html).toContain(row.name); expect(html).toContain("غير محفوظة");
    expect(html).toContain("العبوة المحفوظة"); expect(html).toContain("2 علبة");
    expect(html).toContain('<select'); expect(html).not.toContain('checked=""');
    expect(html).toContain('value="inhaler" selected=""');
  });
  it("wires edits and per-item approval explicitly, and blocks an invalid proposal", () => {
    const onUnit = vi.fn(), onReviewed = vi.fn();
    const element = SupplierUnitReviewRow({ row, unit: "inhaler", reviewed: false, disabled: false, onUnit, onReviewed });
    const nodes: any[] = [];
    const visit = (node: any) => { if (!node?.props) return; nodes.push(node);
      (Array.isArray(node.props.children) ? node.props.children : [node.props.children]).flat().forEach(visit); };
    visit(element);
    nodes.find(n => n.type === "select").props.onChange({ target: { value: "inhaler" } });
    nodes.find(n => n.type === "input").props.onChange({ target: { checked: true } });
    expect(onUnit).toHaveBeenCalledWith("inhaler"); expect(onReviewed).toHaveBeenCalledWith(true);
    const html = renderToStaticMarkup(<SupplierUnitReviewRow row={row} unit="vial" reviewed={false}
      disabled={false} onUnit={onUnit} onReviewed={onReviewed} />);
    expect(html).toContain("لا يمكن اعتماد القيمة الحالية");
    expect(html).toContain('type="checkbox" disabled=""');
  });
});
