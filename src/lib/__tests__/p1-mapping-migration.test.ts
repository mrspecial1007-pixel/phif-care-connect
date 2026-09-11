import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("P1 mapping migration", () => {
  it("allows same-moment mapping corrections", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260910000000_allow_same_moment_mapping_close.sql"),
      "utf8",
    );

    expect(sql).toContain("DROP CONSTRAINT IF EXISTS pmm_effective_range");
    expect(sql).toContain("CHECK (effective_to IS NULL OR effective_to >= effective_from)");
    expect(sql).not.toContain("effective_to > effective_from");
  });
});
