"use client";

import { useMemo, useState } from "react";
import type { Clip, ID, EasingFn, BezierHandles } from "@movie-desk/core";
import { sampleKeyframeTrack } from "@movie-desk/core";
import { Copy, ClipboardPaste } from "lucide-react";
import { useProjectStore, selectPlayhead } from "@/stores/project-store";
import { useKeyframeClipboard } from "@/stores/keyframe-clipboard-store";
import { InspectorSection } from "@/components/inspector-section";
import { useT } from "@/i18n/use-t";

interface Props {
  clipId: ID;
  clip: Clip;
}

const GRAPH_W = 280;
const GRAPH_H = 120;

const EASINGS: readonly EasingFn[] = ["linear", "ease-in", "ease-out", "ease-in-out", "step", "bezier"];
const DEFAULT_BEZIER: BezierHandles = [0.25, 0.1, 0.25, 1];

// Visualizes a clip's keyframe tracks as value curves over clip time and lets
// the user drag individual keyframes vertically (value) to retune them.
export function KeyframeGraph({ clipId, clip }: Props) {
  const t = useT();
  const playhead = useProjectStore(selectPlayhead);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const setKeyframeEasing = useProjectStore((s) => s.setKeyframeEasing);
  const pasteKeyframes = useProjectStore((s) => s.pasteKeyframesTo);
  const copyClipboard = useKeyframeClipboard((s) => s.copy);
  const clipboardTracks = useKeyframeClipboard((s) => s.tracks);
  const tracks = clip.keyframes;
  const [active, setActive] = useState<string | null>(tracks[0]?.target ?? null);
  const [selectedAt, setSelectedAt] = useState<number | null>(null);

  const track = tracks.find((tr) => tr.target === active) ?? tracks[0] ?? null;
  const selectedKf = track?.keyframes.find((k) => k.at === selectedAt) ?? null;

  const range = useMemo(() => {
    if (!track || track.keyframes.length === 0) return { min: 0, max: 1 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const k of track.keyframes) {
      min = Math.min(min, k.value);
      max = Math.max(max, k.value);
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.15;
    return { min: min - pad, max: max + pad };
  }, [track]);

  if (tracks.length === 0) {
    return (
      <InspectorSection title={t("kfgraph.title")}>
        <p className="text-2xs text-ink-3">{t("kfgraph.empty")}</p>
        {clipboardTracks && clipboardTracks.length > 0 && (
          <button
            type="button"
            onClick={() => pasteKeyframes(clipId, clipboardTracks)}
            className="flex items-center gap-1 rounded bg-panel-2 px-2 py-1 text-2xs text-ink-3 hover:text-ink-1"
          >
            <ClipboardPaste className="size-3" />
            {t("kfgraph.paste")}
          </button>
        )}
      </InspectorSection>
    );
  }

  const dur = Math.max(1, clip.duration);
  const toX = (atMs: number) => (atMs / dur) * GRAPH_W;
  const toY = (v: number) => GRAPH_H - ((v - range.min) / (range.max - range.min)) * GRAPH_H;

  const curve = track
    ? Array.from({ length: 60 }, (_, i) => {
        const tt = (i / 59) * dur;
        const v = sampleKeyframeTrack(track, tt) ?? 0;
        return `${toX(tt).toFixed(1)},${toY(v).toFixed(1)}`;
      }).join(" L")
    : "";

  const relPlayhead = Math.max(0, Math.min(dur, playhead - clip.start));

  const onDragKeyframe = (atMs: number, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement!;
    const move = (ev: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const y = Math.max(0, Math.min(GRAPH_H, ev.clientY - rect.top));
      const value = range.min + (1 - y / GRAPH_H) * (range.max - range.min);
      if (track) addKeyframe(clipId, track.target, atMs, value);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <InspectorSection
      title={t("kfgraph.title")}
      headerExtra={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => copyClipboard(tracks)}
            title={t("kfgraph.copy")}
            className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
          >
            <Copy className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => clipboardTracks && pasteKeyframes(clipId, clipboardTracks)}
            disabled={!clipboardTracks}
            title={t("kfgraph.paste")}
            className="rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1 disabled:opacity-30"
          >
            <ClipboardPaste className="size-3" />
          </button>
          <select
            value={active ?? ""}
            onChange={(e) => setActive(e.target.value)}
            className="rounded bg-white/5 px-1.5 py-0.5 text-2xs text-ink-1 outline-none"
          >
            {tracks.map((tr) => (
              <option key={tr.target} value={tr.target} className="bg-panel-2">
                {tr.target}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <svg
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        className="w-full rounded border border-white/5 bg-panel-2"
        style={{ height: GRAPH_H }}
        aria-hidden="true"
      >
        {/* grid */}
        <line x1={0} y1={GRAPH_H / 2} x2={GRAPH_W} y2={GRAPH_H / 2} stroke="rgba(255,255,255,0.06)" />
        {/* playhead */}
        <line
          x1={toX(relPlayhead)}
          y1={0}
          x2={toX(relPlayhead)}
          y2={GRAPH_H}
          stroke="rgba(99,102,241,0.6)"
        />
        {/* curve */}
        {curve && <path d={`M${curve}`} fill="none" stroke="#818cf8" strokeWidth={1.5} />}
        {/* keyframes */}
        {track?.keyframes.map((k) => (
          <circle
            key={k.at}
            cx={toX(k.at)}
            cy={toY(k.value)}
            r={k.at === selectedAt ? 5.5 : 4}
            fill={k.at === selectedAt ? "#f87171" : "#fbbf24"}
            stroke="#000"
            strokeWidth={0.5}
            style={{ cursor: "ns-resize" }}
            onPointerDown={(e) => {
              setSelectedAt(k.at);
              onDragKeyframe(k.at, e);
            }}
          />
        ))}
      </svg>

      {selectedKf && track && (
        <div className="space-y-2 rounded border border-white/5 bg-panel-2 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-ink-3">{t("kfgraph.easing")}</span>
            <select
              value={selectedKf.easing}
              onChange={(e) => {
                const next = e.target.value as EasingFn;
                setKeyframeEasing(
                  clipId,
                  track.target,
                  selectedKf.at,
                  next,
                  next === "bezier" ? (selectedKf.bezier ?? DEFAULT_BEZIER) : undefined,
                );
              }}
              className="flex-1 rounded bg-white/5 px-1.5 py-0.5 text-2xs text-ink-1 outline-none"
            >
              {EASINGS.map((e) => (
                <option key={e} value={e} className="bg-panel-2">
                  {t(`easing.${e}`)}
                </option>
              ))}
            </select>
          </div>
          {selectedKf.easing === "bezier" && (
            <div className="grid grid-cols-4 gap-1">
              {(["x1", "y1", "x2", "y2"] as const).map((lbl, i) => {
                const handles = selectedKf.bezier ?? DEFAULT_BEZIER;
                return (
                  <label key={lbl} className="flex flex-col gap-0.5 text-3xs text-ink-3">
                    {lbl}
                    <input
                      type="number"
                      step={0.05}
                      value={handles[i]}
                      onChange={(ev) => {
                        const v = Number(ev.target.value);
                        const next = [...handles] as [number, number, number, number];
                        // Clamp x to [0,1]; y can overshoot for elastic curves.
                        next[i] = i % 2 === 0 ? Math.max(0, Math.min(1, v)) : v;
                        setKeyframeEasing(clipId, track.target, selectedKf.at, "bezier", next);
                      }}
                      className="w-full rounded bg-white/5 px-1 py-0.5 text-3xs text-ink-1 outline-none"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </InspectorSection>
  );
}
