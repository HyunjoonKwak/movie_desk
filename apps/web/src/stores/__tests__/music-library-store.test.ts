import { describe, expect, it } from "vitest";
import type { ID } from "@movie-desk/core";
import { useMusicLibraryStore } from "../music-library-store";

const reset = () => useMusicLibraryStore.setState({ refs: [] });

describe("music library store", () => {
  it("adds a reference with generated id, newest first", () => {
    reset();
    const s = useMusicLibraryStore.getState();

    const a = s.addRef({ title: "First", license: "free", moods: ["잔잔한"], scenes: [] });
    const b = s.addRef({ title: "Second", license: "paid", moods: [], scenes: ["여행"] });

    const refs = useMusicLibraryStore.getState().refs;
    expect(refs.map((r) => r.title)).toEqual(["Second", "First"]);
    expect(a.id).not.toBe(b.id);
    expect(refs[0]!.addedAt).toBeGreaterThan(0);
  });

  it("updates and removes by id", () => {
    reset();
    const s = useMusicLibraryStore.getState();
    const a = s.addRef({ title: "Track", license: "unknown", moods: [], scenes: [] });

    s.updateRef(a.id, { license: "free", assetId: "asset-1" as ID, moods: ["신나는"] });
    expect(useMusicLibraryStore.getState().refs[0]).toMatchObject({
      title: "Track",
      license: "free",
      assetId: "asset-1",
      moods: ["신나는"],
    });

    s.removeRef(a.id);
    expect(useMusicLibraryStore.getState().refs).toHaveLength(0);
  });
});
