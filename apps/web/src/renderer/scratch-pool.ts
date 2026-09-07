import type { GL } from "./gl";
import { type TargetFormat, allocateTarget } from "./gl";
import type { TargetLease } from "./render-target";

export interface ScratchSlot {
  readonly tex: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
}

interface Entry extends ScratchSlot {
  readonly width: number;
  readonly height: number;
  leased: boolean;
}

// Depth separates suspended frames; role separates simultaneously live passes.
// Size belongs to the entry, not a global invalidation flag. A leased entry is
// never resized or destroyed, even when another invocation requests its key.
// Each key retains at most one idle size; extra live leases retire on release.
export class ScratchPool {
  private readonly slots = new Map<string, Entry[]>();
  private disposed = false;

  constructor(
    private readonly gl: GL,
    private readonly format?: TargetFormat,
  ) {}

  lease(depth: number, role: number, width: number, height: number): TargetLease {
    if (this.disposed) throw new Error("Scratch pool is disposed");
    const key = `${depth}:${role}`;
    const entries = this.slots.get(key) ?? [];
    let entry = entries.find((e) => !e.leased && e.width === width && e.height === height);
    if (!entry) {
      for (const idle of entries.filter((e) => !e.leased)) {
        this.destroy(idle);
        entries.splice(entries.indexOf(idle), 1);
      }
      entry = { ...allocateTarget(this.gl, width, height, this.format), width, height, leased: false };
      entries.push(entry);
      this.slots.set(key, entries);
    }
    entry.leased = true;
    const selected = entry;
    let released = false;
    return {
      ...selected,
      clearAlpha: 0,
      release: () => {
        if (released) return;
        released = true;
        selected.leased = false;
        if (this.disposed || entries.some((e) => e !== selected && !e.leased)) {
          this.destroy(selected);
          entries.splice(entries.indexOf(selected), 1);
        }
        if (!entries.length) this.slots.delete(key);
      },
    };
  }

  // Legacy audit access to the idle root slot; rendering uses explicit leases.
  acquire(role: number): ScratchSlot {
    const lease = this.lease(0, role, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
    lease.release();
    return { tex: lease.tex, fbo: lease.fbo! };
  }

  dispose(): void {
    this.disposed = true;
    for (const [key, entries] of this.slots) {
      for (const entry of entries.filter((e) => !e.leased)) {
        this.destroy(entry);
        entries.splice(entries.indexOf(entry), 1);
      }
      if (!entries.length) this.slots.delete(key);
    }
  }

  private destroy(entry: Entry): void {
    this.gl.deleteTexture(entry.tex);
    this.gl.deleteFramebuffer(entry.fbo);
  }
}
