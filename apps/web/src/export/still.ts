import type { ID, MediaAsset } from "@movie-desk/core";
import { Compositor } from "@/renderer/compositor";
import { useProjectStore } from "@/stores/project-store";

// Renders the frame at the current playhead at full project resolution and
// downloads it as a PNG. Uses a throwaway compositor so the still matches the
// export pipeline rather than the (DPR-scaled) preview canvas.
export const exportStillFrame = async (): Promise<void> => {
  const project = useProjectStore.getState().project;
  const { w, h } = project.resolution;
  const assets = new Map(project.mediaLibrary.map((a) => [a.id, a]));
  const getAsset = (id: ID): MediaAsset | undefined => assets.get(id);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const compositor = new Compositor(canvas);
  try {
    compositor.resize(w, h);
    const at = project.timeline.playhead;
    compositor.setPlayheadGetter(() => at);
    // Render twice: the first pass primes async media decoders, the second
    // composites the now-available frame.
    await compositor.renderFrame(project, getAsset);
    await compositor.renderFrame(project, getAsset);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = Math.round(at);
    a.href = url;
    a.download = `${project.name || "frame"}-${stamp}ms.png`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    compositor.dispose();
  }
};
