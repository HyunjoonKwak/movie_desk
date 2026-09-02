import { afterEach, describe, expect, it, vi } from "vitest";
import { writeMediaFile } from "../opfs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OPFS media writes", () => {
  it("aborts and removes a partial file when a write fails", async () => {
    const failure = new DOMException("quota reached", "QuotaExceededError");
    const writable = {
      write: vi.fn().mockRejectedValue(failure),
      close: vi.fn(),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const root = {
      getFileHandle: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue(writable),
      }),
      removeEntry,
    };
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn().mockResolvedValue(root) },
    });

    await expect(writeMediaFile("asset.bin", new File(["bytes"], "asset.bin"))).rejects.toBe(
      failure,
    );
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith("asset.bin");
    expect(writable.close).not.toHaveBeenCalled();
  });
});
