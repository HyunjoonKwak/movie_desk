"use client";

import { useRef } from "react";
import { GripVertical, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Clip, ID } from "@movie-desk/core";
import { newId } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { listEffects } from "@/effects/registry";
import { useT, type Translate } from "@/i18n/use-t";
import type { MessageKey } from "@/i18n/messages";
import type { EffectDefinition } from "@/effects/types";
import { useLutStore } from "@/effects/lut/lut-store";
import { parseCube } from "@/effects/lut/parse-cube";

interface Props {
  clipId: ID;
  effects: Clip["effects"];
}

const EFFECT_NAME_KEY: Record<string, MessageKey> = {
  brightness: "effects.brightness",
  "gaussian-blur": "effects.gaussianBlur",
  vignette: "effects.vignette",
  "bg-remove": "effects.bgRemove",
};

const PARAM_LABEL_KEY: Record<string, MessageKey> = {
  "brightness.amount": "effects.brightness.amount",
  "gaussian-blur.sigma": "effects.gaussianBlur.sigma",
  "vignette.intensity": "effects.vignette.intensity",
  "vignette.softness": "effects.vignette.softness",
  "bg-remove.feather": "effects.bgRemove.feather",
};

const CATEGORY_KEY: Record<string, MessageKey> = {
  color: "effects.cat.color",
  blur: "effects.cat.blur",
  stylize: "effects.cat.stylize",
  transform: "effects.cat.transform",
  audio: "effects.cat.audio",
};

const effectName = (t: Translate, def: { type: string; name: string }): string => {
  const key = EFFECT_NAME_KEY[def.type];
  return key ? t(key) : def.name;
};

const paramLabel = (
  t: Translate,
  effectType: string,
  param: { key: string; label: string },
): string => {
  const key = PARAM_LABEL_KEY[`${effectType}.${param.key}`];
  return key ? t(key) : param.label;
};

function LutPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const luts = useLutStore((s) => s.luts);
  const addLut = useLutStore((s) => s.addLut);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = parseCube(raw); // validate
      const id = newId();
      addLut({ id, name: file.name.replace(/\.cube$/i, ""), size: parsed.size, raw });
      onChange(id);
      toast.success(`LUT loaded: ${file.name}`);
    } catch (err) {
      toast.error(`LUT parse failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
      >
        <option value="" className="bg-panel-2">
          — none —
        </option>
        {luts.map((l) => (
          <option key={l.id} value={l.id} className="bg-panel-2">
            {l.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
        title="Load .cube LUT"
      >
        <Upload className="size-3" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".cube,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const groupByCategory = (defs: readonly EffectDefinition[]) => {
  const order = ["color", "blur", "stylize", "transform", "audio"];
  const grouped = new Map<string, EffectDefinition[]>();
  for (const d of defs) {
    const list = grouped.get(d.category) ?? [];
    list.push(d);
    grouped.set(d.category, list);
  }
  const sorted: { category: string; items: EffectDefinition[] }[] = [];
  for (const cat of order) if (grouped.has(cat)) sorted.push({ category: cat, items: grouped.get(cat)! });
  for (const [cat, items] of grouped) {
    if (!order.includes(cat)) sorted.push({ category: cat, items });
  }
  return sorted;
};

export function EffectsSection({ clipId, effects }: Props) {
  const addEffect = useProjectStore((s) => s.addEffect);
  const removeEffect = useProjectStore((s) => s.removeEffect);
  const setParam = useProjectStore((s) => s.setEffectParamValue);
  const toggleEffect = useProjectStore((s) => s.toggleEffect);
  const reorder = useProjectStore((s) => s.reorderEffectById);
  const defs = listEffects();
  const t = useT();
  const grouped = groupByCategory(defs);

  const onDragStart = (e: React.DragEvent, effectId: string) => {
    e.dataTransfer.setData("text/effect-id", effectId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("text/effect-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };
  const onDrop = (e: React.DragEvent, toIndex: number) => {
    const id = e.dataTransfer.getData("text/effect-id");
    if (!id) return;
    e.preventDefault();
    reorder(clipId, id as Parameters<typeof reorder>[1], toIndex);
  };

  return (
    <InspectorSection
      title={t("effects.title")}
      headerExtra={
        <details className="relative">
          <summary className="btn-ghost cursor-pointer list-none px-1.5 py-0.5 text-2xs">
            <Plus className="size-3" /> {t("effects.add")}
          </summary>
          <div className="absolute right-0 z-30 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-white/10 bg-panel-3 p-1 shadow-lg">
            {grouped.map(({ category, items }) => (
              <div key={category} className="mb-1">
                <div className="px-2 py-1 text-3xs uppercase tracking-wider text-ink-3">
                  {CATEGORY_KEY[category] ? t(CATEGORY_KEY[category]!) : category}
                </div>
                {items.map((d) => (
                  <button
                    key={d.type}
                    type="button"
                    onClick={() => addEffect(clipId, d.type)}
                    className="block w-full rounded px-2 py-1 text-left text-xs text-ink-1 hover:bg-white/10"
                  >
                    {effectName(t, d)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </details>
      }
    >
      {effects.length === 0 && <p className="text-xs text-ink-3">{t("effects.none")}</p>}

      <ul className="space-y-2">
        {effects.map((fx, idx) => {
          const def = defs.find((d) => d.type === fx.type);
          if (!def) return null;
          return (
            <li
              key={fx.id}
              className="rounded-md border border-white/5 bg-panel-2 p-2"
              draggable
              onDragStart={(e) => onDragStart(e, fx.id)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, idx)}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs">
                  <GripVertical className="size-3 cursor-grab text-ink-3" />
                  <input
                    type="checkbox"
                    checked={fx.enabled}
                    onChange={() => toggleEffect(clipId, fx.id)}
                    className="accent-accent"
                  />
                  <span className="font-medium text-ink-1">{effectName(t, def)}</span>
                </label>
                <button
                  type="button"
                  onClick={() => removeEffect(clipId, fx.id)}
                  className="rounded p-0.5 text-ink-3 hover:bg-red-500/20 hover:text-red-300"
                  title={t("effects.remove")}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {def.params.map((p) => {
                  if (p.kind === "number") {
                    const v = Number(fx.params[p.key] ?? p.default);
                    return (
                      <div key={p.key}>
                        <div className="flex items-center justify-between text-2xs text-ink-3">
                          <span>{paramLabel(t, def.type, p)}</span>
                          <span className="font-mono text-ink-1">{v.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          value={v}
                          onChange={(e) => setParam(clipId, fx.id, p.key, Number(e.target.value))}
                          className="mt-1 w-full accent-accent"
                        />
                      </div>
                    );
                  }
                  if (p.kind === "color") {
                    const v = String(fx.params[p.key] ?? p.default);
                    return (
                      <div key={p.key} className="flex items-center gap-2">
                        <span className="flex-1 text-2xs text-ink-3">{p.label}</span>
                        <input
                          type="color"
                          value={v}
                          onChange={(e) => setParam(clipId, fx.id, p.key, e.target.value)}
                          className="h-6 w-10 cursor-pointer rounded border border-white/5 bg-transparent"
                        />
                      </div>
                    );
                  }
                  if (p.kind === "boolean") {
                    const v = Boolean(fx.params[p.key] ?? p.default);
                    return (
                      <label key={p.key} className="flex items-center gap-2 text-2xs text-ink-3">
                        <input
                          type="checkbox"
                          checked={v}
                          onChange={(e) => setParam(clipId, fx.id, p.key, e.target.checked)}
                          className="accent-accent"
                        />
                        {p.label}
                      </label>
                    );
                  }
                  if (p.kind === "enum" && def.type === "lut" && p.key === "lutId") {
                    return (
                      <LutPicker
                        key={p.key}
                        value={String(fx.params[p.key] ?? "")}
                        onChange={(id) => setParam(clipId, fx.id, p.key, id)}
                      />
                    );
                  }
                  if (p.kind === "enum") {
                    const v = String(fx.params[p.key] ?? p.default);
                    return (
                      <div key={p.key} className="flex items-center gap-2">
                        <span className="flex-1 text-2xs text-ink-3">{p.label}</span>
                        <select
                          value={v}
                          onChange={(e) => setParam(clipId, fx.id, p.key, e.target.value)}
                          className="rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
                        >
                          {p.options.map((o) => (
                            <option key={o.value} value={o.value} className="bg-panel-2">
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}
