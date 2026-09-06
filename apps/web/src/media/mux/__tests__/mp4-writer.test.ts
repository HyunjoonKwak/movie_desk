import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALL_FORMATS,
  BlobSource,
  type EncodedPacket,
  EncodedPacketSink,
  Input,
  type InputTrack,
} from "mediabunny";
import { describe, expect, it } from "vitest";
import { Mp4Writer } from "../mp4-writer";

const FIXTURE = path.join(__dirname, "../../__tests__/fixtures/aac-video.mp4");

const open = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([buffer])) });
};

// Presentation span of a track's packets. Unlike `computeDuration()` this
// ignores edit lists, which the writer does not carry over (nor did
// mp4-muxer): AAC priming packets shift the re-based track by ~46 ms.
const packetSpan = (packets: readonly EncodedPacket[]): number => {
  const first = packets[0];
  const last = packets[packets.length - 1];
  return first && last ? last.timestamp + last.duration - first.timestamp : 0;
};

const packetsOf = async (track: InputTrack): Promise<EncodedPacket[]> => {
  const out: EncodedPacket[] = [];
  for await (const packet of new EncodedPacketSink(track).packets()) out.push(packet);
  return out;
};

const boxOffset = (bytes: Uint8Array, type: string): number =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(type, 0, "latin1");

describe("Mp4Writer", () => {
  it("re-muxes video and audio packets into a fast-start MP4 with the same timeline", async () => {
    const source = open(new Uint8Array(await readFile(FIXTURE)));
    const video = await source.getPrimaryVideoTrack();
    const audio = await source.getPrimaryAudioTrack();
    if (!video || !audio || video.codec !== "avc") throw new Error("fixture lost a track");
    const videoPackets = await packetsOf(video);
    const audioPackets = await packetsOf(audio);
    const videoConfig = await video.getDecoderConfig();
    const audioConfig = await audio.getDecoderConfig();
    if (!videoConfig || !audioConfig) throw new Error("fixture lost a decoder config");

    const writer = new Mp4Writer({
      video: { codec: video.codec, width: video.codedWidth, height: video.codedHeight },
      audio: {
        codec: "aac",
        numberOfChannels: audio.numberOfChannels,
        sampleRate: audio.sampleRate,
      },
    });
    // Offset every timestamp by a second: the writer must re-base each track
    // to start at 0, like the encoder-driven call sites rely on.
    const shiftUs = 1_000_000;
    videoPackets.forEach((p, i) =>
      writer.addVideoChunkRaw(
        p.data,
        p.type,
        p.timestamp * 1_000_000 + shiftUs,
        p.duration * 1_000_000,
        i === 0 ? { decoderConfig: videoConfig } : undefined,
      ),
    );
    audioPackets.forEach((p, i) =>
      writer.addAudioChunkRaw(
        p.data,
        p.type,
        p.timestamp * 1_000_000 + shiftUs,
        p.duration * 1_000_000,
        i === 0 ? { decoderConfig: audioConfig } : undefined,
      ),
    );
    const bytes = new Uint8Array(await writer.finalize());

    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(boxOffset(bytes, "moov")).toBeLessThan(boxOffset(bytes, "mdat"));

    const result = open(bytes);
    const outVideo = await result.getPrimaryVideoTrack();
    const outAudio = await result.getPrimaryAudioTrack();
    if (!outVideo || !outAudio) throw new Error("output lost a track");
    expect(outVideo.codec).toBe(video.codec);
    expect([outVideo.codedWidth, outVideo.codedHeight]).toEqual([
      video.codedWidth,
      video.codedHeight,
    ]);
    expect(outAudio.codec).toBe("aac");
    expect([outAudio.sampleRate, outAudio.numberOfChannels]).toEqual([
      audio.sampleRate,
      audio.numberOfChannels,
    ]);

    const outVideoPackets = await packetsOf(outVideo);
    const outAudioPackets = await packetsOf(outAudio);
    expect(outVideoPackets.length).toBe(videoPackets.length);
    expect(outAudioPackets.length).toBe(audioPackets.length);
    expect(outVideoPackets[0]?.timestamp).toBe(0);
    expect(outAudioPackets[0]?.timestamp).toBe(0);
    expect(outVideoPackets.map((p) => p.type)).toEqual(videoPackets.map((p) => p.type));
    expect(await result.computeDuration()).toBeCloseTo(
      Math.max(packetSpan(videoPackets), packetSpan(audioPackets)),
      2,
    );
  });

  it("applies a sample-accurate audio edit without dropping or changing encoded packets", async () => {
    const input = open(new Uint8Array(await readFile(FIXTURE)));
    const source = (await input.getPrimaryAudioTrack())!;
    const packets = await packetsOf(source);
    const config = (await source.getDecoderConfig())!;
    const offsetSamples = 1024;
    const writer = new Mp4Writer({
      audio: {
        codec: "aac",
        sampleRate: source.sampleRate,
        numberOfChannels: source.numberOfChannels,
        presentation: {
          offsetSamples,
          lengthSamples: source.sampleRate / 2,
          sampleRate: source.sampleRate,
        },
      },
    });
    packets.forEach((packet, i) =>
      writer.addAudioChunkRaw(
        packet.data,
        packet.type,
        packet.timestamp * 1e6,
        packet.duration * 1e6,
        i === 0 ? { decoderConfig: config } : undefined,
      ),
    );
    const resultBytes = new Uint8Array(await writer.finalize());
    const result = open(resultBytes);
    const track = (await result.getPrimaryAudioTrack())!;
    const roundTrip = await packetsOf(track);
    expect(roundTrip).toHaveLength(packets.length);
    expect(roundTrip[0]!.timestamp).toBeCloseTo(-offsetSamples / source.sampleRate, 5);
    for (let i = 0; i < packets.length; i++) expect(roundTrip[i]!.data).toEqual(packets[i]!.data);
    const elst = boxOffset(resultBytes, "elst") - 4;
    const view = new DataView(resultBytes.buffer, resultBytes.byteOffset, resultBytes.byteLength);
    expect(view.getInt32(elst + 20)).toBe(offsetSamples);
    expect(view.getUint32(elst + 28)).toBe(0); // empty trailing edit, no packet truncation
    input.dispose();
    result.dispose();
  });

  it("refuses writes for tracks that were not declared", () => {
    expect(() => new Mp4Writer({})).toThrow(/video or an audio track/);
    const writer = new Mp4Writer({ video: { codec: "avc", width: 16, height: 16 } });
    expect(() => writer.addAudioChunkRaw(new Uint8Array(1), "key", 0, 1000)).toThrow(/no audio/);
  });
});
