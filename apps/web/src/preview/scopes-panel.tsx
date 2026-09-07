"use client";
import { useT } from "@/i18n/use-t";
import type { clipping } from "@/scopes/compute";
import { releaseFrame, subscribeFrames } from "@/scopes/frames";
import type { ScopeKind } from "@/scopes/paint";
import { useEffect, useRef, useState } from "react";

export function ScopesPanel() {
  const [kind, setKind] = useState<ScopeKind>("histogram");
  const [stats, setStats] = useState<ReturnType<typeof clipping> | null>(null);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useT();
  const kindRef = useRef(kind);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    kindRef.current = kind;
    window.dispatchEvent(new Event("scopes-redraw"));
  }, [kind]);
  useEffect(() => {
    setStats(null);
    setFailed(false);
    let worker: Worker;
    try {
      worker = new Worker(new URL("../scopes/scope.worker.ts", import.meta.url));
    } catch {
      setFailed(true);
      return;
    }
    let lastStats = "";
    let stopped = false;
    let unsubscribe = () => {};
    const fail = () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      worker.terminate();
      if (attempt === 0) setAttempt(1);
      else setFailed(true);
    };
    worker.onmessage = (event) => {
      if (!releaseFrame(event.data.pixels, event.data.generation)) {
        event.data.bitmap?.close();
        return;
      }
      if (event.data.error) {
        fail();
        return;
      }
      const { bitmap, stats: next, captureMs, workerMs } = event.data;
      const started = performance.now();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("bitmaprenderer");
      if (ctx) ctx.transferFromImageBitmap(bitmap);
      else bitmap.close();
      if (canvas) {
        canvas.dataset.captureMs = String(captureMs);
        canvas.dataset.workerMs = String(workerMs);
        canvas.dataset.paintMs = String(performance.now() - started);
      }
      const key = JSON.stringify(next);
      if (key !== lastStats) {
        setStats(next);
        lastStats = key;
      }
    };
    unsubscribe = subscribeFrames((data) =>
      worker.postMessage({ ...data, kind: kindRef.current }, [data.pixels.buffer]),
    );
    window.addEventListener("scopes-error", fail);
    worker.onerror = fail;
    return () => {
      window.removeEventListener("scopes-error", fail);
      unsubscribe();
      worker.onmessage = null;
      worker.terminate();
      releaseFrame();
    };
  }, [attempt]);
  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="scopes-panel">
      <label className="flex items-center gap-2 p-2 text-xs">
        {t("scopes.tab")}
        <select
          aria-label={t("scopes.tab")}
          value={kind}
          onChange={(e) => setKind(e.target.value as ScopeKind)}
          className="min-w-0 flex-1 bg-surface-2 p-1"
        >
          {(["histogram", "luma", "waveform", "parade", "vectorscope"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`scopes.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="relative mx-auto min-h-0 w-full max-w-[304px] bg-black px-6 py-2">
        <canvas
          ref={canvasRef}
          width={256}
          height={200}
          className="block h-auto w-full"
          aria-label={t(`scopes.${kind}`)}
        />
        <div
          className="pointer-events-none absolute inset-x-6 inset-y-2 flex flex-col justify-between text-[9px] text-white/50"
          aria-hidden="true"
        >
          {kind === "waveform" || kind === "parade" ? (
            [100, 75, 50, 25, 0].map((v) => (
              <div key={v} className="border-t border-white/20">
                {v} IRE
              </div>
            ))
          ) : kind === "vectorscope" ? (
            <>
              <div className="text-center">Cr +</div>
              <div className="flex justify-between border-t border-white/20">
                <span>Cb −</span>
                <span>+</span>
                <span>Cb +</span>
              </div>
              <div className="text-center">Cr −</div>
            </>
          ) : (
            <div className="mt-auto flex justify-between border-b border-white/20">
              <span>0</span>
              <span>128</span>
              <span>255</span>
            </div>
          )}
        </div>
      </div>
      <p className="p-2 text-2xs text-ink-3" data-testid="scope-values">
        {failed
          ? t("scopes.unavailable")
          : stats
            ? `${t("scopes.samples")}: ${stats.samples} · ${t("scopes.low")}: ${stats.low} (${stats.lowPercent.toFixed(2)}%) · ${t("scopes.high")}: ${stats.high} (${stats.highPercent.toFixed(2)}%)`
            : t("scopes.waiting")}
      </p>
      <p className="px-2 text-2xs text-ink-3">{t("scopes.encoded")}</p>
    </div>
  );
}
