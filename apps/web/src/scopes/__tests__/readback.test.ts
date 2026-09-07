import { afterEach, expect, it, vi } from "vitest";
import { ScopeReadback } from "../readback";
afterEach(() => vi.unstubAllGlobals());
it("waits for a GPU fence without blocking, preserves GL bindings, and frees resources", () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const state = new Map<number, unknown>([
    [1, "read"],
    [2, "draw"],
    [3, "pack"],
    [4, "rb"],
  ]);
  const gl = {
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
    READ_FRAMEBUFFER_BINDING: 1,
    DRAW_FRAMEBUFFER_BINDING: 2,
    PIXEL_PACK_BUFFER_BINDING: 3,
    RENDERBUFFER_BINDING: 4,
    READ_FRAMEBUFFER: 5,
    DRAW_FRAMEBUFFER: 6,
    PIXEL_PACK_BUFFER: 7,
    RENDERBUFFER: 8,
    FRAMEBUFFER_COMPLETE: 9,
    TIMEOUT_EXPIRED: 10,
    WAIT_FAILED: 11,
    ALREADY_SIGNALED: 20,
    CONDITION_SATISFIED: 21,
    RGBA8: 12,
    COLOR_ATTACHMENT0: 13,
    STREAM_READ: 14,
    COLOR_BUFFER_BIT: 15,
    NEAREST: 16,
    RGBA: 17,
    UNSIGNED_BYTE: 18,
    SYNC_GPU_COMMANDS_COMPLETE: 19,
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createBuffer: () => ({}),
    fenceSync: () => ({}),
    getParameter: (key: number) => state.get(key),
    bindFramebuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bindRenderbuffer: vi.fn(),
    renderbufferStorage: vi.fn(),
    framebufferRenderbuffer: vi.fn(),
    bufferData: vi.fn(),
    checkFramebufferStatus: () => 9,
    blitFramebuffer: vi.fn(),
    readPixels: vi.fn(),
    flush: vi.fn(),
    clientWaitSync: vi.fn().mockReturnValueOnce(10).mockReturnValue(20),
    deleteSync: vi.fn(),
    isContextLost: () => false,
    getBufferSubData: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteRenderbuffer: vi.fn(),
  };
  const reader = new ScopeReadback(gl as unknown as WebGL2RenderingContext);
  const done = vi.fn();
  const failed = vi.fn();
  reader.capture(done, failed);
  const reentered = vi.fn();
  reader.capture(done, reentered);
  expect(reentered).toHaveBeenCalledOnce();
  expect(gl.blitFramebuffer).toHaveBeenCalledOnce();
  expect(gl.blitFramebuffer).toHaveBeenCalledWith(0, 0, 1920, 1080, 0, 0, 256, 144, 15, 16);
  expect(gl.bufferData).toHaveBeenCalledWith(7, 256 * 144 * 4, 14);
  expect(gl.readPixels).toHaveBeenCalledWith(0, 0, 256, 144, 17, 18, 0);
  expect(gl.bindFramebuffer).toHaveBeenCalledWith(5, "read");
  expect(gl.bindFramebuffer).toHaveBeenCalledWith(6, "draw");
  expect(gl.bindBuffer).toHaveBeenLastCalledWith(7, "pack");
  expect(gl.bindRenderbuffer).toHaveBeenLastCalledWith(8, "rb");
  callbacks.shift()!(0);
  expect(done).not.toHaveBeenCalled();
  expect(gl.getBufferSubData).not.toHaveBeenCalled();
  callbacks.shift()!(1);
  expect(done).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
  expect(gl.clientWaitSync.mock.calls.every((call) => call[1] === 0 && call[2] === 0)).toBe(true);
  expect(done.mock.calls[0]![0].pixels.length).toBe(256 * 144 * 4);
  reader.dispose();
  expect(gl.deleteBuffer).toHaveBeenCalledOnce();
  expect(gl.deleteFramebuffer).toHaveBeenCalledOnce();
  expect(gl.deleteRenderbuffer).toHaveBeenCalledOnce();
});
