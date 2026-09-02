"use client";

import { newId, type ID } from "@movie-desk/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MusicLicense, MusicRef } from "@/music/types";

// App-level music reference library — persists across projects in
// localStorage (metadata only; audio files live in the media bin/OPFS).
interface MusicLibraryState {
  readonly refs: readonly MusicRef[];
  addRef: (draft: Omit<MusicRef, "id" | "addedAt">) => MusicRef;
  updateRef: (id: ID, patch: Partial<Omit<MusicRef, "id" | "addedAt">>) => void;
  clearAssetLink: (id: ID) => void;
  removeRef: (id: ID) => void;
}

const noopStorage: Storage = {
  length: 0,
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {},
};

// Persisted data is user-editable localStorage — coerce every field so a
// stale or hand-mangled entry can never crash the panel with a TypeError.
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const optStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const sanitizeRef = (raw: unknown): MusicRef | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || r.title.length === 0) return null;
  const license: MusicLicense =
    r.license === "free" || r.license === "paid" ? r.license : "unknown";
  const artist = optStr(r.artist);
  const sourceUrl = optStr(r.sourceUrl);
  const youtubeUrl = optStr(r.youtubeUrl);
  const youtubeTitle = optStr(r.youtubeTitle);
  const note = optStr(r.note);
  const assetId = optStr(r.assetId);
  const fileHash = optStr(r.fileHash);
  const fileName = optStr(r.fileName);
  const bpm =
    typeof r.bpm === "number" && Number.isFinite(r.bpm) && r.bpm >= 20 && r.bpm <= 400
      ? r.bpm
      : undefined;
  return {
    id: (optStr(r.id) ?? newId()) as ID,
    title: r.title,
    license,
    moods: strings(r.moods),
    scenes: strings(r.scenes),
    addedAt: typeof r.addedAt === "number" ? r.addedAt : 0,
    ...(artist ? { artist } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(youtubeUrl ? { youtubeUrl } : {}),
    ...(youtubeTitle ? { youtubeTitle } : {}),
    ...(note ? { note } : {}),
    ...(assetId ? { assetId: assetId as ID } : {}),
    ...(fileHash ? { fileHash } : {}),
    ...(fileName ? { fileName } : {}),
    ...(bpm ? { bpm } : {}),
  };
};

const dropAssetLink = ({ assetId: _drop, ...rest }: MusicRef): MusicRef => rest;

export const useMusicLibraryStore = create<MusicLibraryState>()(
  persist(
    (set) => ({
      refs: [],
      addRef: (draft) => {
        const ref: MusicRef = { ...draft, id: newId(), addedAt: Date.now() };
        set((s) => ({ refs: [ref, ...s.refs] }));
        return ref;
      },
      updateRef: (id, patch) =>
        set((s) => ({ refs: s.refs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      clearAssetLink: (id) =>
        set((s) => ({ refs: s.refs.map((r) => (r.id === id ? dropAssetLink(r) : r)) })),
      removeRef: (id) => set((s) => ({ refs: s.refs.filter((r) => r.id !== id) })),
    }),
    {
      name: "cut.music-library.v1",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : window.localStorage,
      ),
      merge: (persisted, current) => {
        const raw =
          persisted && typeof persisted === "object"
            ? (persisted as { refs?: unknown }).refs
            : undefined;
        const refs = Array.isArray(raw)
          ? raw.map(sanitizeRef).filter((r): r is MusicRef => r !== null)
          : [];
        return { ...current, refs };
      },
    },
  ),
);
