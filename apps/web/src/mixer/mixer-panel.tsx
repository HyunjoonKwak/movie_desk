"use client";

import { type MixerEdit, newId } from "@movie-desk/core";
import { PrecisionInput } from "@/components/precision-input";
import { PrecisionSlider } from "@/components/precision-slider";
import { StateHint } from "@/components/state-hint";
import { useT } from "@/i18n/use-t";
import { useProjectStore } from "@/stores/project-store";
import { MixerMeter } from "./mixer-meter";

function GainControl({
  value,
  label,
  edit,
}: { value: number; label: string; edit: (gainDb: number) => MixerEdit }) {
  const update = useProjectStore((s) => s.updateMixer);
  const preview = useProjectStore((s) => s.previewMixer);
  const props = {
    value,
    label,
    min: -60,
    max: 12,
    step: 0.1,
    onChange: (v: number) => update(edit(v)),
    onPreview: (v: number) => preview(edit(v)),
  };
  return (
    <div className="space-y-1">
      <PrecisionInput {...props} unit="dB" />
      <PrecisionSlider {...props} />
    </div>
  );
}

export function MixerPanel() {
  const t = useT();
  const allTracks = useProjectStore((s) => s.project.timeline.tracks);
  const audio = useProjectStore((s) => s.project.audio);
  const update = useProjectStore((s) => s.updateMixer);
  const preview = useProjectStore((s) => s.previewMixer);
  const toggleMute = useProjectStore((s) => s.toggleTrackMute);
  const toggleSolo = useProjectStore((s) => s.toggleTrackSolo);
  const tracks = allTracks.filter((track) => track.kind === "audio" || track.kind === "video");
  const buses = audio?.buses ?? [];
  return (
    <section aria-label={t("mixer.title")} className="flex h-full min-w-0 flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-line p-2">
        <h2>{t("mixer.title")}</h2>
        <button
          type="button"
          className="rounded border border-line px-2 py-1"
          onClick={() =>
            update({ kind: "bus-add", id: newId(), name: `${t("mixer.bus")} ${buses.length + 1}` })
          }
        >
          {t("mixer.addBus")}
        </button>
      </div>
      {!tracks.some((track) => track.clips.length) && <StateHint text={t("mixer.empty")} />}
      {allTracks.some((track) => track.solo) && <StateHint text={t("mixer.soloActive")} />}
      <div className="flex flex-1 items-start gap-2 overflow-auto p-2" data-testid="mixer-strips">
        {tracks.map((track) => (
          <section
            key={track.id}
            aria-label={track.name}
            className="w-44 shrink-0 space-y-3 rounded border border-line bg-panel-2 p-2"
          >
            <h3 className="truncate font-medium">{track.name}</h3>
            <GainControl
              value={track.audio?.gainDb ?? 0}
              label={`${track.name} ${t("mixer.gain")}`}
              edit={(gainDb) => ({ kind: "track", id: track.id, patch: { gainDb } })}
            />
            <div className="block">
              {t("mixer.pan")}
              <PrecisionSlider
                value={track.audio?.pan ?? 0}
                min={-1}
                max={1}
                step={0.01}
                label={`${track.name} ${t("mixer.pan")}`}
                onChange={(pan) => update({ kind: "track", id: track.id, patch: { pan } })}
                onPreview={(pan) => preview({ kind: "track", id: track.id, patch: { pan } })}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={track.muted}
                aria-label={`${track.name} ${t("timeline.mute")}`}
                className="rounded border border-line px-2 aria-pressed:bg-red-500/30"
                onClick={() => toggleMute(track.id)}
              >
                M
              </button>
              <button
                type="button"
                aria-pressed={track.solo}
                aria-label={`${track.name} ${t("timeline.solo")}`}
                className="rounded border border-line px-2 aria-pressed:bg-amber-500/30"
                onClick={() => toggleSolo(track.id)}
              >
                S
              </button>
            </div>
            <label className="block">
              {t("mixer.route")}
              <select
                className="mt-1 w-full bg-panel-1 p-1"
                aria-label={`${track.name} ${t("mixer.route")}`}
                value={buses.some((bus) => bus.id === track.audio?.busId) ? track.audio?.busId : ""}
                onChange={(e) =>
                  update({ kind: "track", id: track.id, patch: { busId: e.target.value } })
                }
              >
                <option value="">{t("mixer.master")}</option>
                {buses.map((bus) => (
                  <option key={bus.id} value={bus.id}>
                    {bus.name}
                  </option>
                ))}
              </select>
            </label>
            <MixerMeter id={`track:${track.id}`} />
          </section>
        ))}
        {buses.map((bus) => (
          <section
            key={bus.id}
            aria-label={bus.name}
            className="w-44 shrink-0 space-y-3 rounded border border-line bg-panel-2 p-2"
          >
            <input
              key={`${bus.id}:${bus.name}`}
              aria-label={`${bus.name} ${t("mixer.name")}`}
              defaultValue={bus.name}
              maxLength={100}
              className="w-full bg-panel-1 p-1"
              onBlur={(e) => {
                update({ kind: "bus", id: bus.id, name: e.target.value });
                e.target.value =
                  useProjectStore.getState().project.audio?.buses.find((b) => b.id === bus.id)?.name ??
                  bus.name;
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = bus.name;
                  e.currentTarget.blur();
                }
              }}
            />
            <GainControl
              value={bus.gainDb}
              label={`${bus.name} ${t("mixer.gain")}`}
              edit={(gainDb) => ({ kind: "bus", id: bus.id, gainDb })}
            />
            <button
              type="button"
              aria-pressed={bus.muted ?? false}
              aria-label={`${bus.name} ${t("timeline.mute")}`}
              className="rounded border border-line px-2 aria-pressed:bg-red-500/30"
              onClick={() => update({ kind: "bus", id: bus.id, muted: !bus.muted })}
            >
              M
            </button>
            <MixerMeter id={`bus:${bus.id}`} />
            <button
              type="button"
              className="text-ink-3"
              onClick={() => update({ kind: "bus-delete", id: bus.id })}
            >
              {t("mixer.deleteBus")}
            </button>
          </section>
        ))}
        <section
          aria-label={t("mixer.master")}
          className="w-44 shrink-0 space-y-3 rounded border border-accent/40 bg-panel-2 p-2"
        >
          <h3>{t("mixer.master")}</h3>
          <GainControl
            value={audio?.master.gainDb ?? 0}
            label={`${t("mixer.master")} ${t("mixer.gain")}`}
            edit={(gainDb) => ({ kind: "master", gainDb })}
          />
          <MixerMeter id="master" />
        </section>
      </div>
    </section>
  );
}
