import type { Translate } from "@/i18n/use-t";
import type { MessageKey } from "@/i18n/messages";
import type { CutReason, CutReasonCode } from "./types";

const MESSAGE_KEY: Record<CutReasonCode, MessageKey> = {
  "user-pinned": "auto.cutReason.user-pinned",
  interest: "auto.cutReason.interest",
  semantic: "auto.cutReason.semantic",
  face: "auto.cutReason.face",
  smile: "auto.cutReason.smile",
  "golden-hour": "auto.cutReason.golden-hour",
  "music-energy": "auto.cutReason.music-energy",
  "heavy-shake-transition": "auto.cutReason.heavy-shake-transition",
  "mild-shake": "auto.cutReason.mild-shake",
  "photo-stack": "auto.cutReason.photo-stack",
  "story-position": "auto.cutReason.storyPosition",
  "map-transition": "auto.cutReason.mapTransition",
  "user-excluded": "auto.cutReason.user-excluded",
  "analysis-pending": "auto.cutReason.analysis-pending",
  blur: "auto.cutReason.blur",
  underexposed: "auto.cutReason.underexposed",
  overexposed: "auto.cutReason.overexposed",
  flat: "auto.cutReason.flat",
  "too-short": "auto.cutReason.too-short",
  shake: "auto.cutReason.shake",
  duplicate: "auto.cutReason.duplicate",
  "target-filled": "auto.cutReason.target-filled",
};

const formatCutReason = (reason: CutReason, t: Translate): string => {
  if (reason.code === "interest") {
    return t(MESSAGE_KEY[reason.code], { score: Math.round(reason.score ?? 0) });
  }
  if (reason.code === "semantic") {
    return t(MESSAGE_KEY[reason.code], { detail: reason.detail ?? "" });
  }
  if (reason.code === "story-position") {
    return reason.detail
      ? t("auto.cutReason.storyPositionPlace", {
          day: reason.day ?? 1,
          detail: reason.detail,
        })
      : t(MESSAGE_KEY[reason.code], { day: reason.day ?? 1 });
  }
  if (reason.code === "map-transition") {
    return t(MESSAGE_KEY[reason.code], { detail: reason.detail ?? "" });
  }
  return t(MESSAGE_KEY[reason.code]);
};

export const formatCutReasons = (reasons: readonly CutReason[], t: Translate): string =>
  reasons.map((reason) => formatCutReason(reason, t)).join(" · ");
