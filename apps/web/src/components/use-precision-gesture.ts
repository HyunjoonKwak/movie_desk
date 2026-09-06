"use client";

import { useEffect, useRef } from "react";
import { useProjectStore } from "@/stores/project-store";

/** Own one preview transaction; unmount cancels and stale tokens cannot write. */
export function usePrecisionGesture(onPreview?: ((value: number) => void) | undefined) {
  const token = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      if (token.current) useProjectStore.getState().endPrecisionEdit(token.current, true);
    },
    [],
  );
  return {
    preview(value: number) {
      if (!onPreview) return;
      const store = useProjectStore.getState();
      token.current ??= store.beginPrecisionEdit();
      store.previewPrecisionEdit(token.current, () => onPreview(value));
    },
    finish(cancel = false) {
      if (!token.current) return false;
      useProjectStore.getState().endPrecisionEdit(token.current, cancel);
      token.current = null;
      return true;
    },
  };
}
