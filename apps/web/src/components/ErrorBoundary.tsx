import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button, Card } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ParkVanta UI failure", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        data-testid="app-error"
        className="flex min-h-screen items-center justify-center p-6"
      >
        <Card className="w-full max-w-lg p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-400/30 bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-300" />
          </div>
          <p className="mt-5 font-mono text-[10px] tracking-[0.2em] text-red-300 uppercase">
            Interface recovered
          </p>
          <h1 className="mt-2 text-xl font-semibold text-white">This screen hit an unexpected error.</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The gate ledger is safe in PostgreSQL. Reload the interface to restore the latest
            server state; no local action was submitted by this screen.
          </p>
          <Button className="mt-6 w-full" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" /> Reload ParkVanta
          </Button>
        </Card>
      </div>
    );
  }
}
