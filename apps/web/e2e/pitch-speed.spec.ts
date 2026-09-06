import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { expect, test } from "@playwright/test";
import { configurePage, importMediaFiles, mediaCard } from "./support";

// Track presentation duration, independent of packet duration: AAC packets
// deliberately retain preroll/end padding outside the audio edit-list window.
const audioPresentationSeconds = (bytes: Buffer): number => {
  const children = (from: number, end: number) => {
    const boxes: { at: number; end: number; type: string }[] = [];
    for (let at = from; at + 8 <= end; ) {
      const size = bytes.readUInt32BE(at);
      if (size < 8 || at + size > end) throw new Error("Invalid fixture MP4 box");
      boxes.push({ at, end: at + size, type: bytes.toString("ascii", at + 4, at + 8) });
      at += size;
    }
    return boxes;
  };
  const moov = children(0, bytes.length).find((box) => box.type === "moov")!;
  const movie = children(moov.at + 8, moov.end);
  const mvhd = movie.find((box) => box.type === "mvhd")!;
  const scale = bytes.readUInt32BE(mvhd.at + (bytes[mvhd.at + 8] === 1 ? 28 : 20));
  for (const track of movie.filter((box) => box.type === "trak")) {
    const entries = children(track.at + 8, track.end);
    const mdia = entries.find((box) => box.type === "mdia")!;
    const hdlr = children(mdia.at + 8, mdia.end).find((box) => box.type === "hdlr")!;
    if (bytes.toString("ascii", hdlr.at + 16, hdlr.at + 20) !== "soun") continue;
    const tkhd = entries.find((box) => box.type === "tkhd")!;
    return (
      (bytes[tkhd.at + 8] === 1
        ? Number(bytes.readBigUInt64BE(tkhd.at + 36))
        : bytes.readUInt32BE(tkhd.at + 28)) / scale
    );
  }
  throw new Error("Export has no audio track");
};

const wav = (seconds: number, diagnostic = false): Buffer => {
  const frames = seconds * 48000;
  const out = Buffer.alloc(44 + frames * 4);
  out.write("RIFF");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(48000, 24);
  out.writeUInt32LE(192000, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const audible = !diagnostic || (i >= 24000 && i < 26400) || i >= frames - 9600;
    const sample = audible ? Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 12000) : 0;
    out.writeInt16LE(sample, 44 + i * 4);
    out.writeInt16LE(-sample, 46 + i * 4);
  }
  return out;
};

const seedAudio = async (
  page: import("@playwright/test").Page,
  seconds: number,
  diagnostic = false,
) => {
  await configurePage(page);
  await page.goto("/editor");
  await importMediaFiles(page, {
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: wav(seconds, diagnostic),
  });
  await expect(mediaCard(page, "tone.wav")).toBeVisible();
  await page.waitForTimeout(500);
  if ((await page.locator("[data-clip]").count()) === 0) {
    await mediaCard(page, "tone.wav").click();
    await page.keyboard.press("e");
  }
  await page.waitForTimeout(500);
  while ((await page.locator("[data-clip]").count()) > 1) {
    await page.locator("[data-clip]").last().click();
    await page.keyboard.press("Delete");
  }
  await page.locator("[data-clip]").first().click();
  const toggle = page.getByRole("checkbox", { name: "Preserve pitch" });
  if (!(await toggle.isVisible()))
    await page.getByRole("button", { name: "Speed", exact: true }).click();
  return toggle;
};

test("pitch toggle is one undo and exported duration matches the timeline", async ({ page }) => {
  test.setTimeout(180000);
  const toggle = await seedAudio(page, 2, true);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole("button", { name: "2x", exact: true }).click();
  const duration = page.getByRole("spinbutton", { name: "Duration", exact: true });
  await duration.fill("00:00:01:00");
  await duration.press("Enter");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Family message 720p").uncheck();
  await dialog.getByLabel("Web (VP9 · MP4)").check();
  const download = page.waitForEvent("download", { timeout: 150000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  const filePath = (await file.path())!;
  const bytes = await import("node:fs/promises").then((fs) => fs.readFile(filePath));
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const video = (await input.getPrimaryVideoTrack())!;
  const durationSec = await video.computeDuration();
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioTrackDuration = audioTrack ? await audioTrack.computeDuration() : null;
  input.dispose();
  await file.saveAs(test.info().outputPath("pitch-aac-boundary.mp4"));
  expect(Math.abs(durationSec - 1)).toBeLessThanOrEqual(1 / 30);
  const aacSupported = await page.evaluate(
    async () =>
      typeof AudioEncoder !== "undefined" &&
      (
        await AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: 48000,
          numberOfChannels: 2,
          bitrate: 128000,
        })
      ).supported,
  );
  if (!aacSupported) {
    test.info().annotations.push({
      type: "codec",
      description: "AAC unavailable; video-only export length verified",
    });
    return;
  }
  expect(audioTrackDuration).not.toBeNull();
  expect(audioTrackDuration!).toBeGreaterThanOrEqual(1); // all padding packets retained
  expect(Math.abs(audioPresentationSeconds(bytes) - 1)).toBeLessThanOrEqual(1 / 30);
  const audio = await page.evaluate(
    async (data) => {
      const bytes = new Uint8Array(data);
      const ctx = new OfflineAudioContext(2, 1, 48000);
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      const pcm = buffer.getChannelData(0);
      let onset = -1;
      for (let i = 0; i < pcm.length; i++)
        if (Math.abs(pcm[i]!) > 0.05) {
          onset = i / buffer.sampleRate;
          break;
        }
      let energy = 0;
      for (let i = 43200; i < 48000; i++) energy += (pcm[i] ?? 0) ** 2;
      const video = document.createElement("video");
      video.src = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = reject;
      });
      const containerDuration = video.duration;
      URL.revokeObjectURL(video.src);
      return {
        duration: buffer.duration,
        onset,
        tailRms: Math.sqrt(energy / 4800),
        containerDuration,
      };
    },
    [...bytes],
  );
  // 0.5s source click maps to 0.25s at 2×. AAC edit-list presentation must
  // preserve both this onset and the requested last 100ms (RMS ≈0.259).
  expect(Math.abs(audio.onset - 0.25)).toBeLessThanOrEqual(1 / 30);
  expect(audio.tailRms).toBeGreaterThan(0.259 * 0.8);
  expect(audio.tailRms).toBeLessThan(0.259 * 1.2);
  expect(Math.abs(audio.duration - 1)).toBeLessThanOrEqual(1 / 30);
  expect(Math.abs(audio.containerDuration - 1)).toBeLessThanOrEqual(1 / 30);
  // biome-ignore lint/suspicious/noConsole: boundary regression evidence.
  console.log("AAC boundary", audio);
  expect(Math.abs(durationSec - 1)).toBeLessThanOrEqual(1 / 30);
});

test("60s stereo preview starts immediately and renders pitch in a worker", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const stats = {
      requestedAt: 0,
      firstSoundMs: 0,
      workerMs: 0,
      dspMs: 0,
      workerCount: 0,
      longestTaskMs: 0,
      pitchMainSliceMs: 0,
    };
    Object.assign(window, { pitchStats: stats });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (stats.requestedAt && !stats.firstSoundMs)
        stats.firstSoundMs = performance.now() - stats.requestedAt;
      return start.apply(this, args);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const started = performance.now();
        this.addEventListener("message", (event) => {
          if (event.data.channels && event.data.dspMs !== undefined) {
            stats.workerCount++;
            stats.workerMs = performance.now() - started;
            stats.dspMs = event.data.dspMs;
          }
        });
      }
    };
    new PerformanceObserver((list) => {
      if (stats.requestedAt)
        for (const entry of list.getEntries())
          if (entry.startTime >= stats.requestedAt)
            stats.longestTaskMs = Math.max(stats.longestTaskMs, entry.duration);
    }).observe({ type: "longtask", buffered: false });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.name === "pitch-main-slice")
          stats.pitchMainSliceMs = Math.max(stats.pitchMainSliceMs, entry.duration);
    }).observe({ type: "measure", buffered: false });
  });
  const toggle = await seedAudio(page, 60);
  await page.getByRole("button", { name: "2x", exact: true }).click();
  const duration = page.getByRole("spinbutton", { name: "Duration", exact: true });
  await duration.fill("00:00:30:00");
  await duration.press("Enter");
  await toggle.check();
  await page.evaluate(() => {
    (window as unknown as { pitchStats: { requestedAt: number } }).pitchStats.requestedAt =
      performance.now();
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { pitchStats: { workerMs: number } }).pitchStats.workerMs,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  const stats = await page.evaluate(
    () =>
      (
        window as unknown as {
          pitchStats: {
            firstSoundMs: number;
            workerMs: number;
            dspMs: number;
            longestTaskMs: number;
            pitchMainSliceMs: number;
          };
        }
      ).pitchStats,
  );
  // biome-ignore lint/suspicious/noConsole: reproducible performance evidence for the B2 audit.
  console.log("B2 pitch benchmark", stats);
  await testInfo.attach("pitch-benchmark", {
    body: JSON.stringify(stats),
    contentType: "application/json",
  });
  expect(stats.firstSoundMs).toBeGreaterThan(0);
  expect(stats.firstSoundMs).toBeLessThanOrEqual(500);
  expect(stats.dspMs).toBeLessThanOrEqual(2000);
  expect(stats.pitchMainSliceMs).toBeLessThanOrEqual(16);
  await page.getByRole("button", { name: "0.5x", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { pitchStats: { workerCount: number } }).pitchStats.workerCount,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});
