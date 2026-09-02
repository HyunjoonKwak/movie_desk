"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t";
import { readMediaFile } from "@/persistence/opfs";
import { useMusicLibraryStore } from "@/stores/music-library-store";
import { useProjectStore } from "@/stores/project-store";
import type { ID, MediaAsset } from "@movie-desk/core";
import { parseYoutubeCredits } from "../credits-parser";
import { readAudioTags } from "../id3";
import { enrichRefFromAsset } from "../link-asset";
import { fetchYoutubeMeta, isHttpUrl, isYoutubeUrl } from "../youtube-meta";
import type { MusicLicense } from "../types";

const parseTags = (raw: string): string[] => {
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const inputCls =
  "w-full rounded-md border border-white/10 bg-panel-2 px-2 py-1.5 text-xs text-ink-1 placeholder:text-ink-3 focus:border-accent focus:outline-none";

export function MusicAddForm({ onDone }: { onDone: () => void }) {
  const addRef = useMusicLibraryStore((s) => s.addRef);
  const audioAssets = useProjectStore((s) => s.project.mediaLibrary).filter(
    (a) => a.kind === "audio",
  );
  const t = useT();
  const [pendingAsset, setPendingAsset] = useState<MediaAsset | null>(null);
  const [url, setUrl] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [license, setLicense] = useState<MusicLicense>("unknown");
  const [sourceUrl, setSourceUrl] = useState("");
  const [moods, setMoods] = useState("");
  const [scenes, setScenes] = useState("");
  const [note, setNote] = useState("");
  const [desc, setDesc] = useState("");
  const [fetching, setFetching] = useState(false);

  // Fill the form from parsed credits (first track wins; license only when
  // the guess is confident).
  const applyCreditsText = (text: string): boolean => {
    const credits = parseYoutubeCredits(text);
    if (credits.length === 0) return false;
    const c = credits[0]!;
    if (c.song) setTitle(c.song);
    if (c.artist) setArtist(c.artist);
    if (c.licenseGuess !== "unknown") setLicense(c.licenseGuess);
    toast.success(t("music.creditsFound", { n: credits.length }));
    return true;
  };

  // Credits from a pasted video description — no network call.
  const onParseCredits = () => {
    if (!applyCreditsText(desc)) toast.error(t("music.creditsNone"));
  };

  // Register one of the user's own audio files: ID3 tags fill title/artist
  // (local parse, no service), and saving links + enriches the asset.
  const onPickAsset = (asset: MediaAsset) => {
    setPendingAsset(asset);
    if (!title) setTitle(asset.name.replace(/\.[a-z0-9]+$/i, ""));
    void (async () => {
      const blob = await readMediaFile(asset.opfsPath);
      if (!blob) return;
      const tags = await readAudioTags(blob);
      // A slow tag read must not clobber a newer selection or the user's
      // typing — apply only while this asset is still the pending one.
      setPendingAsset((current) => {
        if (current?.id === asset.id) {
          if (tags.title) setTitle(tags.title);
          if (tags.artist) setArtist(tags.artist);
        }
        return current;
      });
    })();
  };

  const onFetch = async () => {
    if (!isYoutubeUrl(url.trim())) {
      toast.error(t("music.fetchInvalid"));
      return;
    }
    setFetching(true);
    try {
      const meta = await fetchYoutubeMeta(url.trim());
      if (meta) {
        setYoutubeTitle(meta.title);
        if (!title) setTitle(meta.title);
        if (!artist && meta.author) setArtist(meta.author);
      } else {
        toast.error(t("music.fetchFailed"));
      }
      // Desktop bonus: the main process can read the watch page (no CORS)
      // and hand back the "Music in this video" credits + description.
      const bridge = (
        window as unknown as {
          cutDesktop?: { fetchMusicCredits?: (u: string) => Promise<string | null> };
        }
      ).cutDesktop;
      if (bridge?.fetchMusicCredits) {
        const text = await bridge.fetchMusicCredits(url.trim());
        if (text) {
          setDesc(text);
          applyCreditsText(text);
        }
      }
    } catch {
      // IPC bridge rejection or unexpected fetch failure — the oEmbed
      // toast (if any) already told the user; never leave an unhandled
      // rejection behind an icon button.
      toast.error(t("music.fetchFailed"));
    } finally {
      setFetching(false);
    }
  };

  const onSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error(t("music.titleRequired"));
      return;
    }
    const trimmedSource = sourceUrl.trim();
    if (trimmedSource && !isHttpUrl(trimmedSource)) {
      toast.error(t("music.sourceInvalid"));
      return;
    }
    // Only a validated YouTube URL is worth storing as one.
    const ytUrl = isYoutubeUrl(url.trim()) ? url.trim() : "";
    // The asset may have been deleted from the bin while the form was open.
    const liveAsset =
      pendingAsset && audioAssets.some((a) => a.id === pendingAsset.id) ? pendingAsset : null;
    const ref = addRef({
      title: trimmedTitle,
      license,
      moods: parseTags(moods),
      scenes: parseTags(scenes),
      ...(artist.trim() ? { artist: artist.trim() } : {}),
      ...(trimmedSource ? { sourceUrl: trimmedSource } : {}),
      ...(ytUrl ? { youtubeUrl: ytUrl } : {}),
      ...(youtubeTitle ? { youtubeTitle } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(liveAsset ? { assetId: liveAsset.id } : {}),
    });
    if (liveAsset) void enrichRefFromAsset(ref.id, liveAsset);
    toast.success(t("music.saved"));
    onDone();
  };

  return (
    <div className="flex flex-col gap-2 border-b border-white/5 bg-panel-1 p-3">
      <p className="text-2xs text-ink-3">{t("music.addHint")}</p>
      {audioAssets.length > 0 && (
        <select
          className="rounded-md border border-white/10 bg-panel-2 px-2 py-1.5 text-xs text-ink-2"
          value={pendingAsset?.id ?? ""}
          onChange={(e) => {
            const picked = audioAssets.find((a) => a.id === e.target.value);
            // Re-selecting the placeholder cancels the pending link.
            if (picked) onPickAsset(picked);
            else setPendingAsset(null);
          }}
          aria-label={t("music.fromBin")}
        >
          <option value="">{t("music.fromBin")}</option>
          {audioAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-1.5">
        <input
          className={inputCls}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("music.youtubeUrl")}
          aria-label={t("music.youtubeUrl")}
        />
        <button
          type="button"
          onClick={() => void onFetch()}
          disabled={fetching}
          aria-label={fetching ? t("music.fetching") : t("music.fetch")}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1.5 text-xs text-ink-2 hover:bg-white/10 disabled:opacity-50"
        >
          {fetching ? <Loader2 className="size-3.5 animate-spin" /> : t("music.fetch")}
        </button>
      </div>
      {youtubeTitle && (
        <p className="truncate text-2xs text-ink-3">
          {t("music.fromVideo", { title: youtubeTitle })}
        </p>
      )}
      <div className="flex gap-1.5">
        <textarea
          className={`${inputCls} min-h-9 resize-y`}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t("music.creditsPlaceholder")}
          aria-label={t("music.creditsPlaceholder")}
        />
        <button
          type="button"
          onClick={onParseCredits}
          className="shrink-0 self-start rounded-md border border-white/10 px-2 py-1.5 text-xs text-ink-2 hover:bg-white/10"
        >
          {t("music.creditsParse")}
        </button>
      </div>
      <input
        className={inputCls}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("music.trackTitle")}
        aria-label={t("music.trackTitle")}
      />
      <div className="flex gap-1.5">
        <input
          className={inputCls}
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder={t("music.artist")}
          aria-label={t("music.artist")}
        />
        <select
          className="shrink-0 rounded-md border border-white/10 bg-panel-2 px-2 py-1.5 text-xs text-ink-1"
          value={license}
          onChange={(e) => setLicense(e.target.value as MusicLicense)}
          aria-label={t("music.license")}
        >
          <option value="free">{t("music.license.free")}</option>
          <option value="paid">{t("music.license.paid")}</option>
          <option value="unknown">{t("music.license.unknown")}</option>
        </select>
      </div>
      <input
        className={inputCls}
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder={t("music.sourceUrl")}
        aria-label={t("music.sourceUrl")}
      />
      <input
        className={inputCls}
        value={moods}
        onChange={(e) => setMoods(e.target.value)}
        placeholder={t("music.moods")}
        aria-label={t("music.moods")}
      />
      <input
        className={inputCls}
        value={scenes}
        onChange={(e) => setScenes(e.target.value)}
        placeholder={t("music.scenes")}
        aria-label={t("music.scenes")}
      />
      <textarea
        className={`${inputCls} min-h-14 resize-y`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("music.note")}
        aria-label={t("music.note")}
      />
      <button
        type="button"
        onClick={onSave}
        className="rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
      >
        {t("music.save")}
      </button>
    </div>
  );
}
