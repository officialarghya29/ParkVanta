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
    <div data-testid="audit-console" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.24em] text-teal-bright uppercase">
            Compliance control
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Audit trail</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Every gate decision, session event and administrative change is written in the same
            transaction as the operation it describes.
          </p>
        </div>
        <Badge tone="teal">
          <ShieldCheck className="h-3 w-3" /> Society scoped
        </Badge>
      </div>

      <Card className="p-6">
        <SectionTitle
          title="Filter the ledger"
          caption="Prefix filters keep large archives responsive; exports cover the visible page."
          action={<Filter className="h-4 w-4 text-teal/70" />}
        />
        <form
          className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
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
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-4">
            <Button type="submit">
              <Filter className="h-4 w-4" /> Apply filters
            </Button>
            <Button type="button" variant="ghost" onClick={resetFilters}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              onClick={exportVisiblePage}
              disabled={!items.length}
            >
              <Download className="h-4 w-4" /> Export page CSV
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-6 py-4">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-teal/70" />
            <p className="text-sm text-slate-300">
              <span className="text-white">{total.toLocaleString()}</span> matching events
            </p>
          </div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
            Page {page} of {pages}
          </p>
        </div>

        <div className="px-6 py-2">
          {audit.isLoading ? <Spinner label="Loading audit ledger" /> : null}
          {audit.error ? <ErrorNote message={(audit.error as Error).message} /> : null}
          {!audit.isLoading && !audit.error && items.length === 0 ? (
            <EmptyState
              title="No matching audit events"
              body="Adjust the action prefix, entity or time window."
            />
          ) : null}
        </div>

        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
                  <th className="px-6 py-3 font-normal">Time</th>
                  <th className="py-3 pr-4 font-normal">Actor</th>
                  <th className="py-3 pr-4 font-normal">Action</th>
                  <th className="py-3 pr-4 font-normal">Entity</th>
                  <th className="py-3 pr-4 font-normal">IP</th>
                  <th className="py-3 pr-6 font-normal">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-white/[0.04] align-top">
                    <td className="px-6 py-3 font-mono text-xs whitespace-nowrap text-slate-500">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="py-3 pr-4 text-slate-200">
                      {item.actor_name ?? "System"}
                    </td>
                    <td className="py-3 pr-4">
                      <code className="rounded-md border border-teal/20 bg-teal/[0.06] px-2 py-1 font-mono text-[11px] text-teal-bright">
                        {item.action}
                      </code>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-slate-300">{item.entity_type}</p>
                      {item.entity_id ? (
                        <p className="mt-0.5 max-w-40 truncate font-mono text-[10px] text-slate-600">
                          {item.entity_id}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11px] text-slate-500">
                      {item.ip_address ?? "—"}
                    </td>
                    <td className="py-3 pr-6">
                      {Object.keys(item.details ?? {}).length ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-slate-400 hover:text-teal-bright">
                            Inspect JSON
                          </summary>
                          <pre className="mt-2 max-w-md overflow-auto rounded-lg border border-white/10 bg-abyss-soft/80 p-3 font-mono text-[10px] leading-relaxed text-slate-400">
                            {JSON.stringify(item.details, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-4">
          <p className="text-xs text-slate-500">
            Newest first. Organization scope is enforced by the API, not the interface.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || audit.isFetching}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
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
