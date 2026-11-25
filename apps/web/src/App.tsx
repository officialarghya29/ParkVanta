import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homeRouteFor, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { Button, Spinner, StudioPane } from "./components/ui";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import type { Role } from "./lib/types";

const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })),
);
const GuardPage = lazy(() =>
  import("./pages/GuardPage").then((m) => ({ default: m.GuardPage })),
);
const InventoryPage = lazy(() =>
  import("./pages/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);
const PassPage = lazy(() =>
  import("./pages/PassPage").then((m) => ({ default: m.PassPage })),
);
const ResidentPage = lazy(() =>
  import("./pages/ResidentPage").then((m) => ({ default: m.ResidentPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function RouteLoading() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center">
      <Spinner label="Loading workspace…" />
    </div>
  );
}

function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner label="Restoring session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeRouteFor(user.role)} replace />;
  return <AppShell>{children}</AppShell>;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner label="Loading…" />
      </div>
    );
  }
  return <Navigate to={user ? homeRouteFor(user.role) : "/login"} replace />;
}

function NotFound() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <StudioPane className="w-full max-w-md p-6 text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-accent">404</p>
        <h1 className="mt-2 text-lg font-semibold text-ink">Page not found</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The workspace route you requested does not exist.
        </p>
        <Button className="mt-5" onClick={() => window.location.assign(user ? homeRouteFor(user.role) : "/login")}>
          Return to workspace
        </Button>
      </StudioPane>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/pass/:token" element={<PassPage />} />
              <Route
                path="/resident"
                element={
                  <RequireRole roles={["RESIDENT"]}>
                    <ResidentPage />
                  </RequireRole>
                }
              />
              <Route
                path="/guard"
                element={
                  <RequireRole
                    roles={["SECURITY_GUARD", "SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"]}
                  >
                    <GuardPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireRole roles={["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"]}>
                    <AdminPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/inventory"
                element={
                  <RequireRole roles={["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"]}>
                    <InventoryPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <RequireRole roles={["SOCIETY_ADMIN", "SUPER_ADMIN"]}>
                    <AuditPage />
                  </RequireRole>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
