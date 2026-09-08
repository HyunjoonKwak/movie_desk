"use client";

import { useEffect } from "react";
import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { setAnalysisAssetLookup, useAnalysisStore } from "./analysis-store";

// ① 가져오기 — 분석 동시 시작. Watches the media library and feeds every new
// asset into the background analyzer, so by the time the wizard opens, the
// ② 리포트 is (mostly) ready. Runs once at the editor root.
export function useAutoAnalysis(): void {
  useEffect(() => {
    setAnalysisAssetLookup(
      (id) => useProjectStore.getState().project.mediaLibrary.find((a) => a.id === id),
    );
    const enqueueAll = () => {
      const assets = useProjectStore.getState().project.mediaLibrary;
      if (assets.length > 0) useAnalysisStore.getState().enqueue(assets);
    };
    // Initial (persisted project restored) + on-change.
    const timer = setTimeout(enqueueAll, 1500);
    const unsub = useProjectStore.subscribe(
      (s) => s.project.mediaLibrary,
      () => enqueueAll(),
    );
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
