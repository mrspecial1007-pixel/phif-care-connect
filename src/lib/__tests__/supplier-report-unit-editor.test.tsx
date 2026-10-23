import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { SupplierReportUnitEditor } from "@/components/management/SupplierReportUnitEditor";

function render(form: string, saved?: string | null, count = 30) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SupplierReportUnitEditor
        item={{
          id: "item",
          form,
          setting: {
            units_per_box: count,
            base_unit: "tablet",
            version: 1,
            supplier_quantity_unit: saved,
            supplier_unit_exceptions: {},
          },
        }}
        rows={[]}
        available
      />
    </QueryClientProvider>,
  );
  client.clear();
  return html.match(/<select aria-label="وحدة صرف PHIF Supplier"[^>]*>(.*?)<\/select>/s)![1];
}

describe("PHIF Supplier unit editor defaults are unsaved UI suggestions", () => {
  for (const [form, unit] of [
    ["tablet", "tablet"],
    ["TABS", "tablet"],
    ["capsule", "capsule"],
    ["CAPS", "capsule"],
    ["PEN", "pen"],
    ["VIAL", "vial"],
    ["Eye Drops", "drops"],
    ["Inhaler", "inhaler"],
    ["Bottle", "bottle"],
  ]) {
    it(`defaults a recognized ${form} form to ${unit}`, () => {
      expect(render(form, null)).toContain(`value="${unit}" selected=""`);
    });
  }

  it("keeps an unrecognized or ambiguous form without a general approval", () => {
    for (const form of ["", "INJ", "unknown"]) {
      expect(render(form)).toContain('value="" selected=""');
    }
  });

  it("prefers saved units over form defaults at any box size", () => {
    for (const count of [1, 28, 30, 60]) {
      for (const saved of ["box", "strip", "tablet"]) {
        expect(render("tablet", saved, count)).toContain(`value="${saved}" selected=""`);
      }
    }
  });

  it("retains the explicit no-approval option and initializes only once without automatic writes", () => {
    expect(render("tablet", "")).toContain('value="" selected=""');
    expect(render("tablet")).toContain('value="">بدون اعتماد عام</option>');
    const source = readFileSync("src/components/management/SupplierReportUnitEditor.tsx", "utf8");
    expect(source).toContain(
      '() => item.setting?.supplier_quantity_unit ?? actualUnit(item.form) ?? ""',
    );
    expect(source).toContain("if (saveLock.current) return");
    expect(source).not.toContain("useEffect");
    expect(source.match(/save\.mutate\(/g)).toHaveLength(1);
  });
});
