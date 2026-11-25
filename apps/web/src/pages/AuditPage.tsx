import { useQuery } from "@tanstack/react-query";
import { Download, Filter, RotateCcw, ScrollText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Spinner,
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
        eyebrow="Compliance & ledger"
        title="Audit trail"
        description="Every gate decision, session event, and administrative change is recorded in the same database transaction."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="teal">
              <ShieldCheck className="h-3 w-3" /> Society scoped
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportVisiblePage}
              disabled={!items.length}
            >
              <Download className="h-3.5 w-3.5" /> Export page CSV
            </Button>
          </div>
        }
      />

      <Card className="p-5">
        <SectionTitle
          title="Filter ledger"
          caption="Prefix filters keep queries fast; CSV export covers the visible page."
        />
        <form
          className="mt-4 grid gap-3.5 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <Field label="Action prefix" hint="e.g. gate. or auth.">
            <Input
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
              placeholder="gate.entry"
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
          <div className="flex flex-wrap items-center gap-2 md:col-span-2 xl:col-span-4">
            <Button type="submit" size="sm">
              <Filter className="h-3.5 w-3.5" /> Apply filters
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3.5">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-accent" />
            <p className="text-sm text-ink-muted">
              <span className="font-semibold text-ink tabular">{total.toLocaleString()}</span> matching events
            </p>
          </div>
          <p className="font-mono text-xs text-ink-subtle">
            Page {page} of {pages}
          </p>
        </div>

        <div className="px-6">
          {audit.isLoading ? <Spinner label="Loading audit ledger" /> : null}
          {audit.error ? (
            <div className="py-4">
              <ErrorNote message={(audit.error as Error).message} />
            </div>
          ) : null}
          {!audit.isLoading && !audit.error && items.length === 0 ? (
            <div className="py-6">
              <EmptyState
                title="No matching audit events"
                body="Adjust the action prefix, entity type, or time window."
              />
            </div>
          ) : null}
        </div>

        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-subtle/70 text-[11px] font-semibold tracking-wider text-ink-subtle uppercase">
                  <th className="px-6 py-3">Time</th>
                  <th className="py-3 pr-4">Actor</th>
                  <th className="py-3 pr-4">Action</th>
                  <th className="py-3 pr-4">Entity</th>
                  <th className="py-3 pr-4">IP address</th>
                  <th className="py-3 pr-6">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-surface-subtle/40">
                    <td className="px-6 py-3 font-mono text-xs whitespace-nowrap text-ink-muted">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-ink">
                      {item.actor_name ?? "System"}
                    </td>
                    <td className="py-3 pr-4">
                      <code className="rounded border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-xs font-medium text-accent">
                        {item.action}
                      </code>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-ink">{item.entity_type}</p>
                      {item.entity_id ? (
                        <p className="mt-0.5 max-w-40 truncate font-mono text-[11px] text-ink-subtle">
                          {item.entity_id}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-ink-muted">
                      {item.ip_address ?? "—"}
                    </td>
                    <td className="py-3 pr-6">
                      {Object.keys(item.details ?? {}).length ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-accent hover:text-accent-hover">
                            Inspect JSON
                          </summary>
                          <pre className="mt-2 max-w-md overflow-auto rounded-lg border border-border bg-surface-subtle p-3 font-mono text-[11px] leading-relaxed text-ink">
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
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3.5">
          <p className="text-xs text-ink-subtle">
            Newest first. Organization isolation is enforced by the API.
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
      </Card>
    </div>
  );
}
