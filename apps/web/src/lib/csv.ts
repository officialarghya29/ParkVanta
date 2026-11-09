import type { AuditLog } from "./types";

const FORMULA_PREFIX = /^[\s]*[=+\-@]/;

export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildAuditCsv(rows: AuditLog[]): string {
  const header = [
    "created_at",
    "actor_name",
    "action",
    "entity_type",
    "entity_id",
    "ip_address",
    "details",
  ];
  const lines = rows.map((row) =>
    [
      row.created_at,
      row.actor_name ?? "system",
      row.action,
      row.entity_type,
      row.entity_id,
      row.ip_address,
      row.details,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}
