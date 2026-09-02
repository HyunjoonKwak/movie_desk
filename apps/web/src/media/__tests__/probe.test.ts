import { describe, expect, it } from "vitest";
import { mediaMimeForFile } from "../probe";

describe("media MIME fallback", () => {
  it("recognises camera files when a folder drag supplies no MIME", () => {
    expect(mediaMimeForFile({ name: "IMG_0001.MOV", type: "" })).toBe("video/quicktime");
    expect(mediaMimeForFile({ name: "VOICE.M4A", type: "" })).toBe("audio/mp4");
    expect(mediaMimeForFile({ name: "PHOTO.JPG", type: "" })).toBe("image/jpeg");
  });

  it("preserves a supplied media MIME and rejects unknown extensions", () => {
    expect(mediaMimeForFile({ name: "renamed.bin", type: "video/webm" })).toBe("video/webm");
    expect(mediaMimeForFile({ name: "notes.txt", type: "" })).toBe("application/octet-stream");
  });
});
