"use client";

import type { TextClip, TextAnimation, TextAlign } from "@movie-desk/core";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";
import { FONT_OPTIONS, FONT_WEIGHTS } from "./fonts";

interface Props {
  clip: TextClip;
}

const ANIMS: readonly TextAnimation[] = ["none", "fade", "typewriter", "slide-up", "slide-down", "pop"];

const ALIGNS: readonly { value: TextAlign; Icon: typeof AlignLeft }[] = [
  { value: "left", Icon: AlignLeft },
  { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight },
];

// One-click caption styles. Each applies a bundle of text style props.
type StylePatch = {
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  shadowBlur?: number;
  weight: number;
};
const STYLE_PRESETS: readonly { key: string; patch: StylePatch }[] = [
  { key: "clean", patch: { color: "#ffffff", strokeColor: "#000000", strokeWidth: 0, shadow: true, weight: 600 } },
  { key: "outline", patch: { color: "#ffffff", strokeColor: "#000000", strokeWidth: 6, shadow: false, weight: 700 } },
  { key: "pop", patch: { color: "#ffe000", strokeColor: "#000000", strokeWidth: 5, shadow: true, weight: 800 } },
  { key: "shadow", patch: { color: "#ffffff", strokeColor: "#000000", strokeWidth: 0, shadow: true, shadowBlur: 16, weight: 600 } },
];

export function TextSection({ clip }: Props) {
  const update = useProjectStore((s) => s.updateTextClip);
  const t = useT();

  return (
    <InspectorSection title={t("text.title")}>
      <textarea
        value={clip.text}
        onChange={(e) => update(clip.id, { text: e.target.value })}
        rows={2}
        className="w-full rounded-md border border-white/5 bg-panel-2 px-2 py-1.5 text-sm text-ink-1 outline-none focus:border-accent"
      />
      <div className="flex flex-wrap gap-1">
        {STYLE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => update(clip.id, p.patch)}
            className="rounded bg-panel-2 px-2 py-0.5 text-3xs text-ink-3 hover:bg-white/10 hover:text-ink-1"
          >
            {t(`text.preset.${p.key}`)}
          </button>
        ))}
      </div>
      <Row label={t("text.font")}>
        <select
          value={clip.font}
          onChange={(e) => update(clip.id, { font: e.target.value })}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
          style={{ fontFamily: clip.font }}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value} className="bg-panel-2" style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("text.weight")}>
        <select
          value={clip.weight ?? 400}
          onChange={(e) => update(clip.id, { weight: Number(e.target.value) })}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
        >
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value} className="bg-panel-2">
              {w.label} ({w.value})
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("text.align")}>
        <div className="flex gap-1">
          {ALIGNS.map(({ value, Icon }) => {
            const active = (clip.align ?? "center") === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => update(clip.id, { align: value })}
                className={`rounded p-1.5 ${active ? "bg-accent text-white" : "bg-white/5 text-ink-3 hover:text-ink-1"}`}
                aria-label={value}
                aria-pressed={active}
              >
                <Icon className="size-3.5" />
              </button>
            );
          })}
        </div>
      </Row>
      <Row label={t("text.size")}>
        <input
          type="range"
          min={16}
          max={256}
          step={1}
          value={clip.size}
          onChange={(e) => update(clip.id, { size: Number(e.target.value) })}
          className="flex-1 accent-accent"
        />
        <span className="w-10 text-right font-mono text-xs text-ink-1">{clip.size}</span>
      </Row>
      <Row label={t("text.color")}>
        <input
          type="color"
          value={clip.color}
          onChange={(e) => update(clip.id, { color: e.target.value })}
          className="h-6 w-10 cursor-pointer rounded border border-white/5 bg-transparent"
        />
      </Row>
      <Row label={t("text.background")}>
        <input
          type="color"
          value={clip.bgColor ?? "#000000"}
          onChange={(e) => update(clip.id, { bgColor: e.target.value })}
          className="h-6 w-10 cursor-pointer rounded border border-white/5 bg-transparent"
        />
        <button
          type="button"
          onClick={() => update(clip.id, { bgColor: "" })}
          className="text-3xs text-ink-3 hover:text-ink-1"
        >
          {t("text.clear")}
        </button>
      </Row>

      <Row label={t("text.outline")}>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={clip.strokeWidth ?? 0}
          onChange={(e) => update(clip.id, { strokeWidth: Number(e.target.value) })}
          className="flex-1 accent-accent"
        />
        <input
          type="color"
          value={clip.strokeColor ?? "#000000"}
          onChange={(e) => update(clip.id, { strokeColor: e.target.value })}
          className="h-6 w-8 cursor-pointer rounded border border-white/5 bg-transparent"
        />
      </Row>
      <Row label={t("text.shadow")}>
        <input
          type="checkbox"
          checked={clip.shadow !== false}
          onChange={(e) => update(clip.id, { shadow: e.target.checked })}
          className="accent-accent"
        />
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={clip.shadowBlur ?? Math.max(2, Math.round(clip.size * 0.1))}
          disabled={clip.shadow === false}
          onChange={(e) => update(clip.id, { shadowBlur: Number(e.target.value) })}
          className="flex-1 accent-accent disabled:opacity-40"
        />
      </Row>

      <div className="text-2xs uppercase tracking-wide text-ink-3">{t("text.anim")}</div>
      <Row label={t("text.animIn")}>
        <select
          value={clip.animIn ?? "none"}
          onChange={(e) => update(clip.id, { animIn: e.target.value })}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
        >
          {ANIMS.map((a) => (
            <option key={a} value={a} className="bg-panel-2">
              {a}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("text.animOut")}>
        <select
          value={clip.animOut ?? "none"}
          onChange={(e) => update(clip.id, { animOut: e.target.value })}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
        >
          {ANIMS.map((a) => (
            <option key={a} value={a} className="bg-panel-2">
              {a}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("text.animMs")}>
        <input
          type="number"
          min={100}
          max={3000}
          step={50}
          value={clip.animMs ?? 500}
          onChange={(e) => update(clip.id, { animMs: Math.max(100, Number(e.target.value)) })}
          className="w-20 rounded bg-white/5 px-2 py-1 text-right text-xs text-ink-1 outline-none"
        />
        <span className="text-3xs text-ink-3">ms</span>
      </Row>
    </InspectorSection>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-2xs uppercase tracking-wide text-ink-3">{label}</span>
      {children}
    </div>
  );
}
