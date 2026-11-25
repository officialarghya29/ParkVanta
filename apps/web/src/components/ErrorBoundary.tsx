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
        className="flex min-h-screen items-center justify-center bg-canvas p-6"
      >
        <Card className="w-full max-w-md p-7 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <p className="mt-4 text-xs font-semibold tracking-wider text-red-700 uppercase">
            Interface recovered
          </p>
          <h1 className="mt-1.5 text-lg font-semibold text-ink">This screen hit an unexpected error.</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
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
