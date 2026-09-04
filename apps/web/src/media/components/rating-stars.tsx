"use client";

import { Star } from "lucide-react";
import type { Rating } from "@movie-desk/core";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/cn";

const STARS: readonly Rating[] = [1, 2, 3, 4, 5];

// A radio group of five stars. Clicking the current rating clears it, so
// one control covers rate and unrate without a separate button.
export function RatingStars({
  value,
  onChange,
  className,
}: {
  readonly value: Rating | null;
  readonly onChange: (rating: Rating | null) => void;
  readonly className?: string;
}) {
  const t = useT();
  return (
    <span
      role="radiogroup"
      aria-label={t("media.rating")}
      className={cn("inline-flex items-center", className)}
      data-testid="rating-stars"
    >
      {STARS.map((n) => {
        const lit = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: a styled star, not a native radio input
            role="radio"
            aria-label={t("media.rateStars", { n })}
            aria-checked={value === n}
            title={value === n ? t("media.rateClear") : t("media.rateStars", { n })}
            onClick={() => onChange(value === n ? null : n)}
            className={cn("rounded p-0.5", lit ? "text-amber-300" : "text-ink-3 hover:text-ink-1")}
          >
            <Star className={cn("size-3", lit && "fill-current")} />
          </button>
        );
      })}
    </span>
  );
}
