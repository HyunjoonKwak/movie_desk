"use client";

import { useEffect, useRef } from "react";
import { useProjectStore } from "@/stores/project-store";

/** Own one preview transaction; unmount cancels and stale tokens cannot write. */
export function usePrecisionGesture(
  onPreview?: ((value: number) => void) | undefined,
  label = "Adjust value",
  value?: number,
) {
  const origin = useRef<number | undefined>(undefined);
  const last = useRef<number | undefined>(undefined);
  const token = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      if (token.current) useProjectStore.getState().endPrecisionEdit(token.current, true);
    },
    [],
  );
  return {
    preview(valueNext: number) {
      if (!onPreview) return;
      const store = useProjectStore.getState();
      if (!token.current) {
        origin.current = value;
        token.current = store.beginPrecisionEdit(label);
      }
      last.current = valueNext;
      store.previewPrecisionEdit(token.current, () => onPreview(valueNext));
    },
    finish(cancel = false) {
      if (!token.current) return false;
      useProjectStore
        .getState()
        .endPrecisionEdit(
          token.current,
          cancel,
          origin.current !== undefined && origin.current === last.current,
        );
      token.current = null;
      return true;
    },
  };
}
