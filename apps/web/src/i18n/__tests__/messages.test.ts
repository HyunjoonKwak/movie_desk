import { describe, expect, it } from "vitest";
import { BLEND_MODES } from "@movie-desk/core";
import { en } from "../messages.en";
import { ko } from "../messages.ko";
import { BLEND_GROUPS } from "@/editor/blend-groups";

// English is the source of truth: MessageKey is derived from it and missing
// Korean entries fall back to English at render time. That fallback means a
// missing translation is invisible in review — it just renders in English —
// so parity is asserted here instead.
describe("message catalogue parity", () => {
  const enKeys = Object.keys(en);
  const koKeys = Object.keys(ko);

  it("translates every English key into Korean", () => {
    const missing = enKeys.filter((k) => !(k in ko));
    expect(missing, `untranslated keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no Korean key that English does not declare", () => {
    const orphaned = koKeys.filter((k) => !(k in en));
    expect(orphaned, `orphaned keys: ${orphaned.join(", ")}`).toEqual([]);
  });

  it("leaves no Korean value empty", () => {
    const blank = koKeys.filter((k) => !(ko as Record<string, string>)[k]?.trim());
    expect(blank, `blank translations: ${blank.join(", ")}`).toEqual([]);
  });
});

describe("blend mode labels", () => {
  it("labels every blend mode in both locales", () => {
    for (const mode of BLEND_MODES) {
      const key = `blend.${mode}`;
      expect(en, `English label missing for "${mode}"`).toHaveProperty(key);
      expect(ko, `Korean label missing for "${mode}"`).toHaveProperty(key);
    }
  });

  it("labels every picker group in both locales", () => {
    for (const group of BLEND_GROUPS) {
      expect(en, `English label missing for "${group.labelKey}"`).toHaveProperty(
        group.labelKey,
      );
      expect(ko, `Korean label missing for "${group.labelKey}"`).toHaveProperty(
        group.labelKey,
      );
    }
  });
});
