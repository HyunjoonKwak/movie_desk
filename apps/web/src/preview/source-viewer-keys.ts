import { useEditorStore as useProjectStore } from "@/stores/editor-store";
import { useSourceViewerStore } from "@/stores/source-viewer-store";
import { markIn, markOut } from "./source-range";

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

// Keys the source viewer owns while it shows an asset: transport, marking
// and stepping act on the source, not the timeline. E/W/D/Q are left to
// the timeline shortcuts, which place the same asset. Returns true when the
// event was handled. `e.code` for letters so a Korean layout still works.
export const handleSourceViewerKey = (e: KeyboardEvent): boolean => {
  const source = useSourceViewerStore.getState();
  if (!source.assetId || e.metaKey || e.ctrlKey || e.altKey) return false;
  const store = useProjectStore.getState();
  const asset = store.project.mediaLibrary.find((a) => a.id === source.assetId);
  if (!asset) return false;
  const duration = Math.max(1, asset.durationMs);

  if (e.code === "Space") {
    e.preventDefault();
    source.toggle();
    return true;
  }
  if (e.key === "Escape") {
    source.close();
    return true;
  }
  if (e.code === "KeyL" && !e.shiftKey) {
    source.setRate(source.playing && source.rate > 0 ? Math.min(source.rate * 2, 8) : 1);
    source.setPlaying(true);
    return true;
  }
  if (e.code === "KeyJ" && !e.shiftKey) {
    source.setRate(source.playing && source.rate < 0 ? Math.max(source.rate * 2, -8) : -1);
    source.setPlaying(true);
    return true;
  }
  if (e.code === "KeyK" && !e.shiftKey) {
    source.setPlaying(false);
    source.setRate(1);
    return true;
  }
  if (e.code === "KeyI" && !e.shiftKey) {
    store.setAssetUseRange(asset.id, markIn(asset, source.playheadMs));
    return true;
  }
  if (e.code === "KeyO" && !e.shiftKey) {
    store.setAssetUseRange(asset.id, markOut(asset, source.playheadMs));
    return true;
  }
  if (e.key === "Home" || e.key === "End") {
    source.setPlayhead(e.key === "Home" ? 0 : duration);
    return true;
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const frameMs = 1000 / Math.max(1, store.project.framerate);
    const step = frameMs * (e.shiftKey ? 10 : 1) * (e.key === "ArrowLeft" ? -1 : 1);
    source.setPlaying(false);
    source.setPlayhead(clamp(source.playheadMs + step, 0, duration));
    return true;
  }
  return false;
};
