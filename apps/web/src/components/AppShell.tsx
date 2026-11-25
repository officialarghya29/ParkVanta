import {
  Activity,
  Building2,
  ClipboardList,
  LogOut,
  Menu,
  QrCode,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { homeRouteFor, useAuth } from "../auth/AuthContext";
import { cn } from "../lib/cn";
import type { Role } from "../lib/types";
import { NotificationCenter } from "./NotificationCenter";

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
  roles: Role[];
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/resident",
    label: "Visitor passes",
    shortLabel: "Passes",
    icon: QrCode,
    roles: ["RESIDENT"],
  },
  {
    to: "/guard",
    label: "Gate console",
    shortLabel: "Gate",
    icon: ShieldCheck,
    roles: ["SECURITY_GUARD", "SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"],
  },
  {
    to: "/admin",
    label: "Overview",
    shortLabel: "Overview",
    icon: Activity,
    roles: ["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"],
    end: true,
  },
  {
    to: "/admin/inventory",
    label: "Inventory",
    shortLabel: "Inventory",
    icon: Building2,
    roles: ["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"],
  },
  {
    to: "/admin/audit",
    label: "Audit trail",
    shortLabel: "Audit trail",
    icon: ClipboardList,
    roles: ["SOCIETY_ADMIN", "SUPER_ADMIN"],
  },
];

const ROUTE_META: Record<string, { title: string; section: string }> = {
  "/resident": { title: "Visitor Passes", section: "Resident Studio" },
  "/guard": { title: "Gate Operations", section: "Security Desk" },
  "/admin": { title: "Operations Overview", section: "Society Workspace" },
  "/admin/inventory": { title: "Property Inventory", section: "Society Workspace" },
  "/admin/audit": { title: "Audit Trail", section: "Compliance" },
};

const ROLE_LABELS: Record<Role, string> = {
  RESIDENT: "Resident",
  SECURITY_GUARD: "Gate Guard",
  PROPERTY_MANAGER: "Manager",
  SOCIETY_ADMIN: "Society Admin",
  SUPER_ADMIN: "Super Admin",
};

export function Brand({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold tracking-tight",
          dark ? "bg-accent text-white" : "bg-rail text-white",
        )}
      >
        PV
      </div>
      {!compact ? (
        <div className="leading-none">
          <span
            className={cn(
              "block text-sm font-semibold tracking-tight",
              dark ? "text-white" : "text-ink",
            )}
          >
            ParkVanta
          </span>
          <span
            className={cn(
              "mt-0.5 block text-[10px] font-medium tracking-wide uppercase",
              dark ? "text-white/55" : "text-ink-subtle",
            )}
          >
            Community Ops
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNav = user ? NAV_ITEMS.filter((item) => item.roles.includes(user.role)) : [];
  const routeMeta = ROUTE_META[location.pathname] ?? {
    title: "Workspace",
    section: "ParkVanta",
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Desktop Studio Tool Rail (Adobe Express inspired slim vertical rail) */}
      <aside className="hidden lg:flex lg:w-[84px] lg:shrink-0 lg:flex-col lg:items-center lg:justify-between lg:border-r lg:border-rail-border lg:bg-rail lg:py-4 print-hidden">
        <div className="flex w-full flex-col items-center gap-5">
          <button
            type="button"
            onClick={() => navigate(user ? homeRouteFor(user.role) : "/")}
            aria-label="ParkVanta home"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white font-mono text-sm font-semibold shadow-xs transition hover:bg-accent-hover"
          >
            PV
          </button>

          <nav aria-label="Workspace navigation" className="flex w-full flex-col items-center gap-1.5 px-2">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  aria-label={item.label}
                  className={({ isActive }) =>
                    cn(
                      "group flex w-full flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2.5 text-center transition-colors",
                      isActive
                        ? "bg-white text-ink shadow-xs"
                        : "text-white/65 hover:bg-rail-elevated hover:text-white",
                    )
                  }
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="text-[10.5px] font-medium leading-tight">{item.shortLabel}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="flex w-full flex-col items-center gap-2 px-2">
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            className="flex w-full flex-col items-center gap-1 rounded-xl px-1.5 py-2 text-white/60 transition hover:bg-rail-elevated hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            <span className="text-[10px] font-medium">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden print-hidden">
          <div
            className="fixed inset-0 bg-ink/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex w-64 flex-col justify-between bg-rail p-4 text-white shadow-2xl">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Brand dark />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-lg p-1.5 text-white/70 hover:bg-rail-elevated hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav aria-label="Mobile workspace navigation" className="space-y-1">
                {visibleNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-white text-ink"
                            : "text-white/75 hover:bg-rail-elevated hover:text-white",
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </nav>
            </div>
            <div className="border-t border-rail-border pt-4">
              {user ? (
                <div className="mb-3 px-1">
                  <p className="truncate text-xs font-medium text-white">{user.full_name}</p>
                  <p className="truncate text-[11px] text-white/55">{ROLE_LABELS[user.role]}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white/75 hover:bg-rail-elevated hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Main Studio Shell Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Crisp Studio Top Utility Bar */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 sm:px-6 print-hidden">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-surface-subtle lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="hidden font-medium text-ink-subtle sm:inline">{routeMeta.section}</span>
              <span className="hidden text-ink-subtle/50 sm:inline">/</span>
              <span className="truncate text-sm font-semibold tracking-tight text-ink">
                {routeMeta.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {user ? (
              <div className="hidden items-center gap-2 rounded-full border border-line bg-surface-subtle px-3 py-1 sm:flex">
                <span className="text-xs font-medium text-ink">{user.full_name}</span>
                <span className="h-3 w-px bg-line-strong" />
                <span className="text-[11px] font-medium text-ink-subtle">
                  {ROLE_LABELS[user.role]}
                </span>
              </div>
            ) : null}
            <NotificationCenter />
          </div>
        </header>

        {/* Studio Main Canvas */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
