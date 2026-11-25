import {
  Activity,
  Building2,
  Car,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  ScrollText,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { homeRouteFor, useAuth } from "../auth/AuthContext";
import { cn } from "../lib/cn";
import { NotificationCenter } from "./NotificationCenter";

const NAV = [
  { to: "/resident", label: "Resident", icon: Car, roles: ["RESIDENT"], section: "My visits" },
  {
    to: "/guard",
    label: "Gate console",
    icon: ScanLine,
    roles: ["SECURITY_GUARD", "SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"],
    section: "Gate operations",
  },
  {
    to: "/admin",
    label: "Operations",
    icon: LayoutDashboard,
    roles: ["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"],
    section: "Management",
  },
  {
    to: "/admin/inventory",
    label: "Inventory",
    icon: Building2,
    roles: ["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"],
    section: "Management",
  },
  {
    to: "/admin/audit",
    label: "Audit trail",
    icon: ScrollText,
    roles: ["SOCIETY_ADMIN", "SUPER_ADMIN"],
    section: "Compliance",
  },
];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Platform owner",
  SOCIETY_ADMIN: "Society admin",
  PROPERTY_MANAGER: "Property manager",
  SECURITY_GUARD: "Security guard",
  RESIDENT: "Resident",
};

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
        <ShieldCheck className="h-4 w-4" strokeWidth={2} />
      </div>
      {!compact ? (
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-ink">ParkVanta</p>
          <p className="text-[10px] font-medium tracking-wider text-ink-subtle uppercase">
            Access & Parking
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  if (!user) return null;
  const items = NAV.filter((item) => item.roles.includes(user.role));
  const currentItem = items.find((item) => item.to === location.pathname);
  const initials = user.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  const sidebarNav = (
    <nav className="flex-1 space-y-1 px-2.5 py-3" aria-label="Primary navigation">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/admin" || item.to === "/resident" || item.to === "/guard"}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent-soft text-accent"
                : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
              collapsed && "justify-center px-2",
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-accent" : "text-ink-subtle group-hover:text-ink",
                )}
                strokeWidth={1.8}
              />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "no-print hidden shrink-0 flex-col border-r border-border bg-white transition-[width] duration-150 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-border px-3.5",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          <NavLink to={homeRouteFor(user.role)} className="flex items-center">
            <Brand compact={collapsed} />
          </NavLink>
        </div>

        {sidebarNav}

        <div className="border-t border-border p-3">
          {!collapsed ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-surface-subtle px-2.5 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-semibold text-white">
                {initials || "PV"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{user.full_name}</p>
                <p className="truncate text-[11px] text-ink-subtle">
                  {ROLE_LABEL[user.role] ?? user.role}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-white hover:text-red-700"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center justify-center rounded-lg p-2 text-ink-subtle transition-colors hover:bg-surface-subtle hover:text-red-700"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen ? (
        <div
          className="no-print fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0 bg-zinc-950/35"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col border-r border-border bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <NavLink to={homeRouteFor(user.role)} onClick={() => setMobileOpen(false)}>
                <Brand />
              </NavLink>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-ink"
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-3" aria-label="Mobile navigation">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/admin" || item.to === "/resident" || item.to === "/guard"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent-soft text-accent"
                        : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-border p-3">
              <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-subtle px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink">{user.full_name}</p>
                  <p className="truncate text-[11px] text-ink-subtle">
                    {ROLE_LABEL[user.role] ?? user.role}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-ink hover:text-red-700"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-surface-subtle hover:text-ink md:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-subtle hover:text-ink md:inline-flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <div className="flex items-center gap-1.5 text-xs text-ink-subtle truncate">
              <span className="hidden sm:inline font-medium text-ink-muted">ParkVanta</span>
              {currentItem ? (
                <>
                  <ChevronRight className="hidden h-3.5 w-3.5 sm:inline" aria-hidden="true" />
                  <span className="truncate font-medium text-ink">{currentItem.label}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              System online
            </span>
            <NotificationCenter />
            <div className="hidden items-center gap-2 border-l border-border pl-2.5 lg:flex">
              <span className="text-xs font-medium text-ink">{user.full_name}</span>
              <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] text-ink-subtle">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>

        <footer className="no-print mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-4 text-xs text-ink-subtle sm:px-6 lg:px-8">
          <span className="font-medium">ParkVanta · Residential Access & Parking Operations</span>
          <span className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            PostgreSQL authoritative · Redis advisory
          </span>
        </footer>
      </div>
    </div>
  );
}
