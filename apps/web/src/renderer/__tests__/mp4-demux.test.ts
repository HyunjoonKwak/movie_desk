import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toByteSource } from "../mp4-decoder";
import { type DemuxPacket, openMp4, videoDecoderConfig } from "../mp4-demux";

const fixture = (name: string): Blob =>
  new Blob([readFileSync(new URL(`../../media/__tests__/fixtures/${name}`, import.meta.url))]);

const collect = async (iterable: AsyncIterable<DemuxPacket>): Promise<DemuxPacket[]> => {
  const out: DemuxPacket[] = [];
  for await (const packet of iterable) out.push(packet);
  return out;
};

// Shared demux entry for the playhead decoder, the linear sampler, container
// inspection and the audio remux: describe the primary tracks from the
// metadata window and hand out packets on demand.
describe("openMp4", () => {
  it("exposes the HEVC track of a QuickTime file with its hvcC description and rotation", async () => {
    const opened = await openMp4(toByteSource(fixture("hevc-rotated90.mov")));
    expect(opened?.container).toBe("mov");
    const track = opened?.videoTrack;
    expect(track?.codec).toMatch(/^(hvc1|hev1)\./);
    expect(track?.rotation).toBe(270); // ffmpeg's +90 is counter-clockwise
    const config = opened ? videoDecoderConfig(opened) : null;
    expect(config?.codec).toBe(track?.codec);
    expect(config?.codedWidth).toBe(160);
    expect(config?.description).toBeInstanceOf(Uint8Array);
    opened?.dispose();
  });

  it("exposes the AVC and AAC tracks of an MP4 with their descriptions", async () => {
    const opened = await openMp4(toByteSource(fixture("aac-video.mp4")));
    expect(opened?.container).toBe("mp4");
    const config = opened ? videoDecoderConfig(opened) : null;
    expect(config?.codec).toMatch(/^avc1\./);
    expect(config?.description).toBeInstanceOf(Uint8Array);
    expect(opened?.durationMs).toBeGreaterThan(900);
    expect(opened?.audioTrack?.codec).toBe("mp4a.40.2");
    expect(opened?.audioTrack?.sampleRate).toBe(22050);
    expect(opened?.audioTrack?.channelCount).toBe(1);
    expect(opened?.audioTrack?.config?.description).toBeInstanceOf(Uint8Array);
    opened?.dispose();
  });

  it("hands out packets in decode order with edit-list-adjusted presentation times", async () => {
    // libx264 with B-frames writes an edit list that hides the reorder delay.
    const opened = await openMp4(toByteSource(fixture("avc-bframes.mp4")));
    const reader = opened?.videoTrack?.packets;
    expect(reader).toBeDefined();
    if (!reader) return;

    const keys = await reader.keyTimesMs();
    expect(keys[0]).toBe(0);
    expect(keys.length).toBeGreaterThan(1);

    const first = await reader.keyPacketAt(0);
    expect(first?.type).toBe("key");
    expect(first?.timestampUs).toBe(0);
    const second = first ? await reader.nextPacket(first) : null;
    // Decode order: the P-frame after the keyframe carries a later time than
    // the B-frames that follow it.
    expect(second?.type).toBe("delta");
    expect(second?.timestampUs).toBeGreaterThan(0);

    const midKey = await reader.keyPacketAt(200_000);
    expect(midKey?.type).toBe("key");
    expect(midKey?.timestampUs).toBe(Math.round((keys[1] as number) * 1000));

    const all = await collect(reader.packets());
    expect(all).toHaveLength(15);
    expect(all.map((packet) => packet.sequence)).toEqual(all.map((_, i) => i));
    expect(Math.min(...all.map((packet) => packet.timestampUs))).toBe(0);

    // A walk from a key packet continues in decode order from there.
    const tail = midKey ? await collect(reader.packets(midKey)) : [];
    expect(tail[0]?.sequence).toBe(midKey?.sequence);
    expect(tail).toHaveLength(15 - (midKey?.sequence ?? 0));
    // And the same packet objects can be continued with nextPacket.
    expect((await reader.nextPacket(tail[0] as DemuxPacket))?.sequence).toBe(tail[1]?.sequence);
    opened?.dispose();
  });

  it("refuses to continue from a packet another reader handed out", async () => {
    const a = await openMp4(toByteSource(fixture("avc-bframes.mp4")));
    const b = await openMp4(toByteSource(fixture("avc-bframes.mp4")));
    const foreign = await a?.videoTrack?.packets.keyPacketAt(0);
    await expect(b?.videoTrack?.packets.nextPacket(foreign as DemuxPacket)).rejects.toThrow(
      /not handed out/,
    );
    a?.dispose();
    b?.dispose();
  });

  it("returns null for bytes that are not an ISO BMFF file", async () => {
    expect(await openMp4(toByteSource(new Blob([new Uint8Array(64)])))).toBeNull();
    const webmish = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 1, 2, 3, 4])]);
    expect(await openMp4(toByteSource(webmish))).toBeNull();
  });
});
