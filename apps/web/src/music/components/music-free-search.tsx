"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Globe, Loader2, Pause, Play, Search } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t";
import { importMediaFile } from "@/media/import";
import { leaseMediaKey } from "@/persistence/media-gc";
import { useMusicLibraryStore } from "@/stores/music-library-store";
import { useProjectStore } from "@/stores/project-store";
import { audioMimeFor, hashBlob, musicStoreKey, safeFileName, saveMusicFile } from "../file-store";
import { estimateTrackBpm } from "../bpm";
import { searchFreeMusic, type FreeTrack } from "../openverse";

const inputCls =
  "w-full rounded-md border border-white/10 bg-panel-2 px-2 py-1.5 text-xs text-ink-1 placeholder:text-ink-3 focus:border-accent focus:outline-none";

export function MusicFreeSearch() {
  const addRef = useMusicLibraryStore((s) => s.addRef);
  const t = useT();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<readonly FreeTrack[]>([]);
  const [searched, setSearched] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Ref, not state — a same-tick double click must not start two imports.
  const importBusy = useRef(false);

  const stopPreview = () => {
    const old = audioRef.current;
    if (old) {
      // Detach handlers first so a late onerror can't clear the NEXT track.
      old.onended = null;
      old.onerror = null;
      old.pause();
      old.src = "";
    }
    audioRef.current = null;
  };

  // Stop the preview when the panel unmounts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup only
  useEffect(() => stopPreview, []);

  const onSearch = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const found = await searchFreeMusic(query);
      setResults(found);
      setSearched(true);
    } catch {
      toast.error(t("music.searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const togglePreview = (track: FreeTrack) => {
    if (playingId === track.id) {
      stopPreview();
      setPlayingId(null);
      return;
    }
    stopPreview();
    const audio = new Audio();
    // Mandatory under our COEP: require-corp headers — a no-cors media
    // request would be blocked (NotSameOriginAfterDefaultedToSameOrigin).
    audio.crossOrigin = "anonymous";
    audio.src = track.audioUrl;
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
      setPlayingId(null);
      toast.error(t("music.previewFailed"));
    };
    void audio.play().catch(() => setPlayingId(null));
    audioRef.current = audio;
    setPlayingId(track.id);
  };

  const onImport = async (track: FreeTrack) => {
    if (importBusy.current) return;
    importBusy.current = true;
    setImportingId(track.id);
    try {
      const res = await fetch(track.audioUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const blob = await res.blob();
      // Openverse URLs are often extension-less query endpoints (Jamendo:
      // "/?trackid=…&format=mp32") — only trust a real dotted suffix.
      const extMatch = /\.([a-z0-9]{2,5})$/i.exec(new URL(track.audioUrl).pathname);
      const ext = extMatch?.[1] ?? "mp3";
      const name = `${safeFileName(track.title)}.${ext}`;
      const file = new File([blob], name, { type: blob.type || audioMimeFor(name) });
      // Copy into the app-global store so other projects can restore it —
      // leased until the library ref commits, so GC can't reap the gap.
      const fileHash = await hashBlob(blob);
      const releaseStore = leaseMediaKey(musicStoreKey(fileHash));
      try {
        await saveMusicFile(fileHash, file);
        const { asset, releaseLease } = await importMediaFile(file);
        try {
          useProjectStore.getState().addMediaAsset(asset);
        } finally {
          releaseLease();
        }
        const ref = addRef({
          title: track.title,
          license: "free",
          moods: [],
          scenes: [],
          sourceUrl: track.landingUrl,
          note: `CC ${track.license.toUpperCase()}`,
          assetId: asset.id,
          fileHash,
          fileName: name,
          ...(track.creator ? { artist: track.creator } : {}),
        });
        // Tempo-aware recommendations — analyzed off the critical path.
        void estimateTrackBpm(blob)
          .then((bpm) => {
            if (bpm) useMusicLibraryStore.getState().updateRef(ref.id, { bpm });
          })
          .catch(() => {});
      } finally {
        releaseStore();
      }
      toast.success(t("music.imported", { name: track.title }));
    } catch (err) {
      // TypeError from fetch = CORS/network refusal — steer to the source page.
      toast.error(t(err instanceof TypeError ? "music.importCors" : "music.importFailed"));
    } finally {
      importBusy.current = false;
      setImportingId(null);
    }
  };

  return (
    <div className="border-b border-white/5 p-3">
      <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-ink-3">
        <Globe className="size-3.5" />
        {t("music.freeSearch")}
      </p>
      <p className="mt-1 text-2xs text-ink-3">{t("music.freeSearchHint")}</p>
      <div className="mt-2 flex gap-1.5">
        <input
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSearch();
          }}
          placeholder={t("music.freeSearchPlaceholder")}
          aria-label={t("music.freeSearch")}
        />
        <button
          type="button"
          onClick={() => void onSearch()}
          disabled={searching}
          aria-label={t("music.search")}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1.5 text-xs text-ink-2 hover:bg-white/10 disabled:opacity-50"
        >
          {searching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Search className="size-3.5" />
          )}
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {searched && results.length === 0 && !searching && (
          <p className="text-2xs text-ink-3">{t("music.freeNoResults")}</p>
        )}
        {results.map((track) => (
          <div
            key={track.id}
            className="flex items-center gap-1.5 rounded-md border border-white/5 bg-panel-2 px-2 py-1.5"
          >
            <button
              type="button"
              onClick={() => togglePreview(track)}
              title={playingId === track.id ? t("music.previewStop") : t("music.preview")}
              aria-label={playingId === track.id ? t("music.previewStop") : t("music.preview")}
              className="shrink-0 rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1"
            >
              {playingId === track.id ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xs text-ink-1">{track.title}</p>
              <p className="truncate text-2xs text-ink-3">
                {track.creator}
                {" · CC "}
                {track.license.toUpperCase()}
                {track.durationMs !== null && ` · ${Math.round(track.durationMs / 1000)}s`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onImport(track)}
              disabled={importingId !== null}
              title={t("music.import")}
              aria-label={t("music.import")}
              className="shrink-0 rounded p-1 text-ink-3 hover:bg-white/10 hover:text-ink-1 disabled:opacity-50"
            >
              {importingId === track.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
