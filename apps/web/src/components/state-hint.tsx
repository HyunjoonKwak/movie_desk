import { Info } from "lucide-react";

export function StateHint({
  text,
  action,
  testId,
}: {
  text: string;
  action?: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-state-hint
      className="flex min-w-0 shrink-0 items-start gap-2 px-2 py-2 text-xs leading-5 text-ink-3"
    >
      <Info className="mt-1 size-3 shrink-0" aria-hidden />
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
      </div>
    </div>
  );
}
