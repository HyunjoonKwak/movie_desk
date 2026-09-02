import { describe, expect, it } from "vitest";
import type { Translate } from "@/i18n/use-t";
import { en } from "@/i18n/messages.en";
import { ko } from "@/i18n/messages.ko";
import { formatCutReasons } from "../reasons";

const translator =
  (catalog: Record<string, string>): Translate =>
  (key, vars) => {
    const template = catalog[key] ?? String(key);
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
  };

describe("cut decision reasons", () => {
  const reasons = [
    { code: "smile" as const },
    { code: "golden-hour" as const },
    { code: "story-position" as const, day: 1, detail: "Seoul" },
    { code: "interest" as const, score: 82.4 },
  ];

  it("formats a structured decision in English", () => {
    expect(formatCutReasons(reasons, translator(en))).toBe(
      "A clear expression or smile · Warm golden-hour light · Day 1 · Seoul · Moment score 82",
    );
  });

  it("formats the same decision in Korean without changing the plan", () => {
    expect(formatCutReasons(reasons, translator(ko))).toBe(
      "표정이나 웃는 모습이 또렷함 · 빛이 따뜻한 골든아워 장면 · 1일차 · Seoul · 장면 점수 82",
    );
  });
});
