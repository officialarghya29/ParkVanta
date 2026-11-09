import { describe, expect, it } from "vitest";
import { buildAuditCsv, csvCell } from "./csv";
import type { AuditLog } from "./types";

const row: AuditLog = {
  id: "audit-1",
  actor_user_id: null,
  actor_name: "Ananya Rao",
  action: "gate.entry_authorized",
  entity_type: "invitation",
  entity_id: "inv-1",
  ip_address: "127.0.0.1",
  details: { note: 'gate, "north"' },
  created_at: "2026-11-09T10:00:00Z",
};

describe("csvCell", () => {
  it("quotes commas, quotes and embedded newlines", () => {
    expect(csvCell('gate, "north"')).toBe('"gate, ""north"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("\"'=SUM(A1:A2)\"");
    expect(csvCell("-2+3")).toBe("\"'-2+3\"");
    expect(csvCell("  =SUM(A1:A2)")).toBe("\"'  =SUM(A1:A2)\"");
  });
});

describe("buildAuditCsv", () => {
  it("includes a stable header and serializes object details", () => {
    const csv = buildAuditCsv([row]);
    const [header, data] = csv.split("\r\n");
    expect(header).toContain('"created_at"');
    expect(data).toContain('"Ananya Rao"');
    expect(data).toContain(csvCell(row.details));
  });
});
