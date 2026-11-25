import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import type { NotificationItem, Page, UnreadCount } from "../lib/types";

const formatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api<UnreadCount>("/notifications/unread-count"),
    refetchInterval: 30_000,
  });

  const list = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => api<Page<NotificationItem>>("/notifications?limit=12"),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) =>
      api<NotificationItem>(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const markAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (!open) return;
    const handleMouse = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleMouse);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouse);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const count = unread.data?.count ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-ink-muted transition-colors hover:border-border-strong hover:bg-surface-subtle hover:text-ink",
          open && "border-accent/40 bg-accent-soft text-accent",
        )}
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {count > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-white shadow-lg"
          role="region"
          aria-label="Notification inbox"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">Notifications</p>
              <p className="text-[11px] text-ink-subtle">{count} unread</p>
            </div>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={count === 0 || markAll.isPending}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {list.isLoading ? (
              <p className="px-4 py-8 text-center text-xs text-ink-subtle">Loading notifications…</p>
            ) : null}
            {!list.isLoading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-ink-subtle">No notifications yet.</p>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!item.read_at) markRead.mutate(item.id);
                }}
                className={cn(
                  "block w-full border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-subtle",
                  !item.read_at && "bg-accent-soft/50",
                )}
              >
                <span className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      item.read_at ? "bg-zinc-300" : "bg-accent",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                      {item.body}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-ink-subtle">
                      {formatter.format(new Date(item.created_at))}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
