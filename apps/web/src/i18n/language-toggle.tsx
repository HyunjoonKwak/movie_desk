"use client";

import { Languages } from "lucide-react";
import { LOCALES } from "./messages";
import { useLocaleStore } from "./store";
import { useT } from "./use-t";

export function LanguageToggle() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();

  return (
    <label
      className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-line-strong bg-panel-2 px-2 text-2xs text-ink-2 transition-colors hover:bg-panel-3"
      title={t("topbar.language")}
    >
      <Languages className="size-3" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number]["code"])}
        className="cursor-pointer appearance-none bg-transparent text-ink-1 outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} className="bg-panel-2 text-ink-1">
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
