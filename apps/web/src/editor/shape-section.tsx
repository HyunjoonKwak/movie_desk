"use client";

import type { ShapeClip, ID, ShapeKind } from "@movie-desk/core";
import { useProjectStore } from "@/stores/project-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clip: ShapeClip;
}

const SHAPES: readonly ShapeKind[] = ["rect", "ellipse", "line"];

export function ShapeSection({ clip }: Props) {
  const update = useProjectStore((s) => s.updateShapeClip);
  const t = useT();
  const id = clip.id as ID;

  return (
    <InspectorSection title={t("shape.title")}>
      <div className="flex gap-1">
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => update(id, { shape: s })}
            className={`flex-1 rounded px-2 py-1 text-2xs ${
              clip.shape === s ? "bg-accent text-accent-fg" : "bg-panel-2 text-ink-3 hover:text-ink-1"
            }`}
          >
            {t(`shape.${s}`)}
          </button>
        ))}
      </div>
      <Row label={t("shape.fill")}>
        <input
          type="color"
          value={clip.fill === "transparent" ? "#000000" : clip.fill}
          onChange={(e) => update(id, { fill: e.target.value })}
          className="h-6 w-10 cursor-pointer rounded border border-white/5 bg-transparent"
        />
        <button
          type="button"
          onClick={() => update(id, { fill: "transparent" })}
          className="text-3xs text-ink-3 hover:text-ink-1"
        >
          {t("shape.noFill")}
        </button>
      </Row>
      <Row label={t("shape.fillType")}>
        <select
          value={clip.fillType ?? "solid"}
          onChange={(e) => update(id, { fillType: e.target.value as "solid" | "linear" | "radial" })}
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-ink-1 outline-none"
        >
          <option value="solid" className="bg-panel-2">{t("shape.solid")}</option>
          <option value="linear" className="bg-panel-2">{t("shape.linear")}</option>
          <option value="radial" className="bg-panel-2">{t("shape.radial")}</option>
        </select>
      </Row>
      {(clip.fillType === "linear" || clip.fillType === "radial") && (
        <>
          <Row label={t("shape.fill2")}>
            <input
              type="color"
              value={clip.fillColor2 ?? "#000000"}
              onChange={(e) => update(id, { fillColor2: e.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-white/5 bg-transparent"
            />
          </Row>
          {clip.fillType === "linear" && (
            <div>
              <div className="flex items-center justify-between text-2xs text-ink-3">
                <span>{t("shape.gradientAngle")}</span>
                <span className="font-mono text-ink-1">{clip.gradientAngle ?? 0}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={clip.gradientAngle ?? 0}
                onChange={(e) => update(id, { gradientAngle: Number(e.target.value) })}
                className="mt-1 w-full accent-accent"
              />
            </div>
          )}
        </>
      )}
      <Row label={t("shape.stroke")}>
        <input
          type="color"
          value={clip.stroke}
          onChange={(e) => update(id, { stroke: e.target.value })}
          className="h-6 w-10 cursor-pointer rounded border border-white/5 bg-transparent"
        />
      </Row>
      <div>
        <div className="flex items-center justify-between text-2xs text-ink-3">
          <span>{t("shape.strokeWidth")}</span>
          <span className="font-mono text-ink-1">{clip.strokeWidth}</span>
        </div>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={clip.strokeWidth}
          onChange={(e) => update(id, { strokeWidth: Number(e.target.value) })}
          className="mt-1 w-full accent-accent"
        />
      </div>
      {clip.shape === "rect" && (
        <div>
          <div className="flex items-center justify-between text-2xs text-ink-3">
            <span>{t("shape.cornerRadius")}</span>
            <span className="font-mono text-ink-1">{clip.cornerRadius ?? 0}</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={clip.cornerRadius ?? 0}
            onChange={(e) => update(id, { cornerRadius: Number(e.target.value) })}
            className="mt-1 w-full accent-accent"
          />
        </div>
      )}
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
