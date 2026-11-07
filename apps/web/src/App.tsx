import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homeRouteFor, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { Button, Card } from "./components/ui";
import { AdminPage } from "./pages/AdminPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { GuardPage } from "./pages/GuardPage";
import { InventoryPage } from "./pages/InventoryPage";
import { LoginPage } from "./pages/LoginPage";
import { PassPage } from "./pages/PassPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ResidentPage } from "./pages/ResidentPage";
import type { Role } from "./lib/types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Protected({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeRouteFor(user.role)} replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to={homeRouteFor(user.role)} replace />;
  return children;
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? homeRouteFor(user.role) : "/login"} replace />;
}

function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to={homeRouteFor(user.role)} replace />;
  return <LoginPage />;
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md p-8 text-center">
        <p className="font-mono text-[10px] tracking-[0.2em] text-teal-bright uppercase">404</p>
        <h1 className="mt-2 text-xl font-semibold text-white">Signal lost</h1>
        <p className="mt-2 text-sm text-slate-400">This route is not part of the ParkVanta surface.</p>
        <a href="/" className="mt-5 inline-flex w-full">
          <Button className="w-full">Return to control room</Button>
        </a>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<LoginRoute />} />
            <Route
              path="/register"
              element={
                <PublicOnly>
                  <RegisterPage />
                </PublicOnly>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <PublicOnly>
                  <ForgotPasswordPage />
                </PublicOnly>
              }
            />
            <Route
              path="/reset-password"
              element={
                <PublicOnly>
                  <ResetPasswordPage />
                </PublicOnly>
              }
            />
            <Route path="/pass/:token" element={<PassPage />} />
            <Route
              path="/resident"
              element={
                <Protected roles={["RESIDENT"]}>
                  <ResidentPage />
                </Protected>
              }
            />
            <Route
              path="/guard"
              element={
                <Protected roles={["SECURITY_GUARD", "SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"]}>
                  <GuardPage />
                </Protected>
              }
            />
            <Route
              path="/admin"
              element={
                <Protected roles={["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"]}>
                  <AdminPage />
                </Protected>
              }
            />
            <Route
              path="/admin/inventory"
              element={
                <Protected roles={["SOCIETY_ADMIN", "PROPERTY_MANAGER", "SUPER_ADMIN"]}>
                  <InventoryPage />
                </Protected>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
