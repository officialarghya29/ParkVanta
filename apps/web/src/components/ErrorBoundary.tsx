import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Button, StudioPane } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Unhandled render error", error, info);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
          <StudioPane className="w-full max-w-md p-6 text-center" data-testid="app-error">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-bad-soft text-bad">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-base font-semibold tracking-tight text-ink">
              Something went wrong
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Reload the workspace to recover. No queued actions have been discarded.
            </p>
            <Button
              className="mt-5"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Reload workspace
            </Button>
          </StudioPane>
        </div>
      );
    }
    return this.props.children;
  }
}
