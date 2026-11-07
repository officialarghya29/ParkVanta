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
    const handle = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const count = unread.data?.count ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative rounded-lg border border-white/10 p-2 text-slate-400 transition-colors hover:border-teal/40 hover:text-white",
          open && "border-teal/40 bg-white/[0.06] text-white",
        )}
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {count > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal px-1 font-mono text-[9px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-abyss/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Notifications</p>
              <p className="font-mono text-[10px] tracking-[0.12em] text-slate-500 uppercase">
                {count} unread
              </p>
            </div>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={count === 0 || markAll.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {list.isLoading ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">Loading notifications…</p>
            ) : null}
            {!list.isLoading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">No notifications yet.</p>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!item.read_at) markRead.mutate(item.id);
                }}
                className={cn(
                  "block w-full border-b border-white/[0.05] px-4 py-3 text-left transition-colors last:border-0 hover:bg-white/[0.04]",
                  !item.read_at && "bg-teal/[0.04]",
                )}
              >
                <span className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      item.read_at ? "bg-slate-700" : "bg-teal-bright",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-100">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{item.body}</span>
                    <span className="mt-1 block font-mono text-[9px] tracking-[0.08em] text-slate-600 uppercase">
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
