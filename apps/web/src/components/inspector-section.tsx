"use client";

import { type ReactNode, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  title: string;
  /** Optional small icon rendered before the title. */
  icon?: ReactNode;
  /** Controls rendered on the right of the header; do not toggle collapse. */
  headerExtra?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

// Collapsible inspector section with a uniform disclosure header. Each
// section component uses this as its root so its header controls stay
// colocated with the section state.
export function InspectorSection({
  title,
  icon,
  headerExtra,
  defaultOpen = true,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-white/5 pb-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-3 transition-colors hover:text-ink-1"
        >
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          {icon}
          {title}
        </button>
        {headerExtra}
      </div>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </section>
  );
}
