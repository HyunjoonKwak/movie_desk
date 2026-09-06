import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export function StateHint({
  text,
  action,
  testId,
  tone = "info",
  dismiss,
}: {
  text: string;
  action?: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  testId?: string;
  tone?: "info" | "warning" | "error";
  dismiss?: { label: string; onClick: () => void };
}) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      data-testid={testId}
      data-state-hint
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex w-full min-w-0 shrink-0 items-start gap-2 px-2 py-2 text-xs leading-5",
        tone === "info"
          ? "text-ink-3"
          : tone === "warning"
            ? "rounded border border-amber-400/30 text-amber-200"
            : "rounded border border-red-400/40 text-red-200",
      )}
    >
      <Icon className="mt-1 size-3 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p>{text}</p>
        {action && (
          <button
            type="button"
            className="mt-1 max-w-full rounded px-1 py-0.5 text-left text-accent hover:bg-white/5 disabled:opacity-50 focus-visible:outline focus-visible:outline-accent"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        )}
        {dismiss && (
          <button
            type="button"
            className="mt-1 block max-w-full rounded px-1 py-0.5 text-left text-ink-3 hover:bg-white/5"
            onClick={dismiss.onClick}
          >
            {dismiss.label}
          </button>
        )}
      </div>
    </div>
  );
}
