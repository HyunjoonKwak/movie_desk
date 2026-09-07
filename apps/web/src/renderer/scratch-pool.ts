// Frame-sized scratch textures shared across render passes. Multiple passes
// (backdrop capture for overlay/soft-light blends, adjustment-layer capture,
// spatial-conform fit target) each used to keep their own private texture
// + framebuffer pair with duplicated lazy-alloc / resize logic. The pool
// consolidates that into a single, indexed cache.
//
// Slots are addressed by a stable integer so independent call sites can
// reserve "slot 0 = backdrop", "slot 1 = fit target" without coordination.
// Concurrent use of the SAME slot in one frame would alias — but the
// compositor's pipeline only ever holds one role at a time per slot.

import type { GL } from "./gl";
import { type TargetFormat, allocateTarget } from "./gl";

export interface ScratchSlot {
  readonly tex: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
}

export class ScratchPool {
  private slots = new Map<number, ScratchSlot>();
  private size = { w: 0, h: 0 };

  constructor(
    private readonly gl: GL,
    private readonly format?: TargetFormat,
  ) {}

  // Hand back the slot at `index`, reallocating all slots when the drawing
  // buffer has resized since the last call. Allocates new slots on demand.
  acquire(index: number): ScratchSlot {
    this.ensureSize();
    let slot = this.slots.get(index);
    if (!slot) {
      slot = this.allocSlot();
      this.slots.set(index, slot);
    }
    return slot;
  }

  dispose(): void {
    for (const s of this.slots.values()) {
      this.gl.deleteTexture(s.tex);
      this.gl.deleteFramebuffer(s.fbo);
    }
    this.slots.clear();
    this.size = { w: 0, h: 0 };
  }

  private ensureSize(): void {
    const w = this.gl.drawingBufferWidth;
    const h = this.gl.drawingBufferHeight;
    if (w === this.size.w && h === this.size.h && this.slots.size > 0) return;
    // Viewport changed (or first call): blow away cached slots so the next
    // acquire reallocates at the correct size.
    this.dispose();
    this.size = { w, h };
  }

  private allocSlot(): ScratchSlot {
    return allocateTarget(this.gl, this.size.w, this.size.h, this.format);
  }
}
