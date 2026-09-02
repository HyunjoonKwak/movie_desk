"use client";

import { Component, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

interface Props {
  // Short label naming the isolated subtree, e.g. "Preview". Shown in the
  // default fallback so a crash reads as "Preview failed", not a blank pane.
  readonly label: string;
  readonly children: ReactNode;
  // Optional custom fallback; receives the error and a reset callback.
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  readonly error: Error | null;
}

// Isolates a subtree so a throw inside it — WebGL context loss, a decoder
// failure, a misbehaving effect — degrades that one panel
// instead of blanking the whole editor. State updates stay immutable.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // biome-ignore lint/suspicious/noConsole: intentional, diagnosable crash log
    console.error(`[cut] ${this.props.label} crashed:`, error);
  }

  private readonly reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <PanelErrorFallback label={this.props.label} error={error} onReset={this.reset} />;
  }
}

function PanelErrorFallback({
  label,
  error,
  onReset,
}: {
  readonly label: string;
  readonly error: Error;
  readonly onReset: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel-0 p-6 text-center">
      <TriangleAlert className="size-6 text-amber-400" aria-hidden />
      <div className="text-sm font-medium text-ink-1">{label} failed to render</div>
      <p className="max-w-xs break-words text-xs text-ink-3">{error.message}</p>
      <button type="button" onClick={onReset} className="btn-ghost mt-1 gap-1.5 text-xs">
        <RotateCcw className="size-3.5" aria-hidden />
        Try again
      </button>
    </div>
  );
}
