import { afterEach, describe, expect, it, vi } from "vitest";
import { quietMp4BoxLogs } from "../mp4box-log";

describe("quietMp4BoxLogs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops console prints but keeps routing errors to a file's onError", () => {
    const printed: string[] = [];
    const log = {
      setLogLevel: vi.fn(),
      warn: vi.fn(),
      error: (module: string, message: string, isofile?: { onError?: unknown }) => {
        if (isofile && typeof isofile.onError === "function") {
          (isofile.onError as (m: string, msg: string) => void)(module, message);
        } else {
          printed.push(`${module}: ${message}`);
        }
      },
    };
    quietMp4BoxLogs(log);
    quietMp4BoxLogs(log); // idempotent
    log.error("BoxParser", "Invalid box type: '©swr'");
    expect(printed).toEqual([]);
    const received: string[] = [];
    log.error("BoxParser", "truncated", {
      onError: (m: string, msg: string) => received.push(`${m}: ${msg}`),
    });
    expect(received).toEqual(["BoxParser: truncated"]);
    expect(log.setLogLevel).toHaveBeenCalledTimes(1);
  });
});
