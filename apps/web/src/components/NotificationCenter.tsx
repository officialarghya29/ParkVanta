import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import type { NotificationItem, Page, UnreadCount } from "../lib/types";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api<UnreadCount>("/notifications/unread-count"),
    refetchInterval: 20_000,
  });

  const list = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => api<Page<NotificationItem>>("/notifications?limit=12"),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const markRead = useMutation({
    mutationFn: (id: string) =>
      api<NotificationItem>(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const count = unread.data?.count ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className={cn(
          "relative inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
          open
            ? "border-accent-border bg-accent-soft text-accent"
            : "border-line bg-surface text-ink-muted hover:bg-surface-subtle hover:text-ink",
        )}
      >
        <Bell className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Inbox</span>
        {count > 0 ? (
          <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-line bg-surface-subtle px-4 py-2.5">
            <span className="text-xs font-semibold text-ink">Activity notifications</span>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 divide-y divide-line overflow-y-auto">
            {list.isLoading ? (
              <p className="px-4 py-8 text-center text-xs text-ink-subtle">Loading inbox…</p>
            ) : !list.data?.items.length ? (
              <p className="px-4 py-8 text-center text-xs text-ink-subtle">No notifications yet.</p>
            ) : (
              list.data.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!item.read_at) markRead.mutate(item.id);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-subtle",
                    !item.read_at && "bg-accent-soft/45",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      item.read_at ? "bg-transparent" : "bg-accent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{item.body}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
