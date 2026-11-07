import { Activity, Building2, Car, LayoutDashboard, LogOut, ScanLine, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { homeRouteFor, useAuth } from "../auth/AuthContext";
import { cn } from "../lib/cn";

const NAV = [
  { to: "/resident", label: "Resident", icon: Car, roles: ["RESIDENT"] },
  { to: "/guard", label: "Gate console", icon: ScanLine, roles: ["SECURITY_GUARD", "SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"] },
  { to: "/admin", label: "Operations", icon: LayoutDashboard, roles: ["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"] },
  { to: "/admin/inventory", label: "Inventory", icon: Building2, roles: ["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"] },
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
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-teal/40 bg-teal/10">
        <span className="absolute inset-x-2 top-2 h-px bg-teal-bright/70" />
        <ShieldCheck className="h-5 w-5 text-teal-bright" strokeWidth={1.8} />
      </div>
      {!compact ? (
        <div className="leading-tight">
          <p className="font-mono text-[13px] font-semibold tracking-[0.34em] text-white">PARKVANTA</p>
          <p className="text-[10px] tracking-[0.18em] text-slate-500 uppercase">Smart access</p>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;
  const items = NAV.filter((item) => item.roles.includes(user.role));

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-abyss/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3.5">
          <NavLink to={homeRouteFor(user.role)} className="flex items-center gap-3">
            <Brand />
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-white/[0.07] text-white"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-teal-bright uppercase sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-bright shadow-[0_0_10px_2px_rgba(46,230,200,0.6)]" />
              System live
            </span>
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight text-white">{user.full_name}</p>
              <p className="text-[11px] text-slate-500">{ROLE_LABEL[user.role] ?? user.role}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-white/10 p-2 text-slate-400 transition-colors hover:border-red-400/40 hover:text-red-200"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5 pb-3 md:hidden">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs",
                  isActive ? "bg-white/[0.08] text-white" : "text-slate-400",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-6 text-[11px] text-slate-600">
        <span className="font-mono tracking-[0.16em] uppercase">ParkVanta · Smart access. Smarter parking.</span>
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          PostgreSQL is the source of truth · Redis is advisory
        </span>
      </footer>
    </div>
  );
}
