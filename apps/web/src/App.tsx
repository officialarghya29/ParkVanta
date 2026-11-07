import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homeRouteFor, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { Button, Card } from "./components/ui";
import { AdminPage } from "./pages/AdminPage";
import { GuardPage } from "./pages/GuardPage";
import { InventoryPage } from "./pages/InventoryPage";
import { LoginPage } from "./pages/LoginPage";
import { PassPage } from "./pages/PassPage";
import { ResidentPage } from "./pages/ResidentPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
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
            <Route path="/pass/:token" element={<PassPage />} />
            <Route
              path="/resident"
              element={
                <Protected>
                  <ResidentPage />
                </Protected>
              }
            />
            <Route
              path="/guard"
              element={
                <Protected>
                  <GuardPage />
                </Protected>
              }
            />
            <Route
              path="/admin"
              element={
                <Protected>
                  <AdminPage />
                </Protected>
              }
            />
            <Route
              path="/admin/inventory"
              element={
                <Protected>
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
