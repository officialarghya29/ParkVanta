import { useQuery } from "@tanstack/react-query";
import { Download, Filter, RotateCcw, ScrollText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StudioPane,
} from "../components/ui";
import { api } from "../lib/api";
import { buildAuditCsv } from "../lib/csv";
import { formatDateTime } from "../lib/format";
import type { AuditLog, Page } from "../lib/types";

const PAGE_SIZE = 25;
const EMPTY_FILTERS = { action: "", entity_type: "", from: "", to: "" };

type Filters = typeof EMPTY_FILTERS;

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function AuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const audit = useQuery({
    queryKey: ["audit", filters, offset],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filters.action.trim()) params.set("action", filters.action.trim());
      if (filters.entity_type) params.set("entity_type", filters.entity_type);
      const from = toIso(filters.from);
      const to = toIso(filters.to);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return api<Page<AuditLog>>(`/audit-logs?${params.toString()}`);
    },
  });

  const items = audit.data?.items ?? [];
  const total = audit.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applyFilters() {
    setOffset(0);
    setFilters(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
  }

  function exportVisiblePage() {
    if (!items.length) return;
    const blob = new Blob([buildAuditCsv(items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `parkvanta-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div data-testid="audit-console" className="space-y-6">
      <PageHeader
        eyebrow="Compliance Ledger"
        title="Audit trail"
        description="Transactional record of every gate authorization, slot transition, session event, and policy update."
        action={
          <div className="flex items-center gap-2">
            <Badge tone="ok" dot>
              <ShieldCheck className="h-3 w-3" />
              Society scoped
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportVisiblePage}
              disabled={!items.length}
            >
              <Download className="h-3.5 w-3.5" />
              Export page CSV
            </Button>
          </div>
        }
      />

      {/* Unified Filter + Ledger Workbench */}
      <StudioPane>
        <form
          className="border-b border-line bg-surface-subtle/60 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Action prefix" hint="e.g. gate. or auth.">
              <Input
                value={draft.action}
                onChange={(event) => setDraft({ ...draft, action: event.target.value })}
                placeholder="gate.entry"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Entity type">
              <Select
                value={draft.entity_type}
                onChange={(event) => setDraft({ ...draft, entity_type: event.target.value })}
              >
                <option value="">All entities</option>
                <option value="invitation">Invitation</option>
                <option value="user">User</option>
                <option value="property">Property</option>
                <option value="organization">Organization</option>
                <option value="parking_slot">Parking slot</option>
                <option value="parking_reservation">Parking reservation</option>
                <option value="parking_occupancy">Parking occupancy</option>
                <option value="society_policy">Society policy</option>
              </Select>
            </Field>
            <Field label="From">
              <Input
                type="datetime-local"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </Field>
            <Field label="To">
              <Input
                type="datetime-local"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">
                <Filter className="h-3.5 w-3.5" />
                Apply filters
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5 text-accent" />
                <strong className="font-semibold text-ink tabular">{total.toLocaleString()}</strong>{" "}
                events
              </span>
              <span className="font-mono text-ink-subtle">
                Page {page} / {pages}
              </span>
            </div>
          </div>
        </form>

        {audit.isLoading ? (
          <div className="p-6">
            <Spinner label="Loading audit ledger…" />
          </div>
        ) : audit.error ? (
          <div className="p-6">
            <ErrorNote message={(audit.error as Error).message} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No matching audit events"
              body="Adjust the action prefix, entity type, or time window."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  <th className="px-5 py-2.5">Time</th>
                  <th className="py-2.5 pr-4">Actor</th>
                  <th className="py-2.5 pr-4">Action</th>
                  <th className="py-2.5 pr-4">Entity</th>
                  <th className="py-2.5 pr-4">IP address</th>
                  <th className="py-2.5 pr-5">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-surface-subtle/60">
                    <td className="px-5 py-3 font-mono text-xs whitespace-nowrap text-ink-muted tabular">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-ink">
                      {item.actor_name ?? "System"}
                    </td>
                    <td className="py-3 pr-4">
                      <code className="rounded-md border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-xs font-medium text-accent">
                        {item.action}
                      </code>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-xs font-medium text-ink">{item.entity_type}</p>
                      {item.entity_id ? (
                        <p className="mt-0.5 max-w-44 truncate font-mono text-[11px] text-ink-subtle">
                          {item.entity_id}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-ink-muted">
                      {item.ip_address ?? "—"}
                    </td>
                    <td className="py-3 pr-5">
                      {Object.keys(item.details ?? {}).length ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-accent hover:text-accent-hover">
                            Inspect JSON
                          </summary>
                          <pre className="mt-2 max-w-md overflow-auto rounded-lg border border-line bg-surface-subtle p-3 font-mono text-[11px] leading-relaxed text-ink">
                            {JSON.stringify(item.details, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-xs text-ink-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-subtle/40 px-5 py-3">
          <p className="text-xs text-ink-subtle">
            Newest first · Organization isolation is enforced by the API.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || audit.isFetching}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || audit.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      </StudioPane>
    </div>
  );
}
