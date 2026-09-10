import { afterEach, expect, it } from "vitest";
import { useRelinkRequestStore } from "../relink-request-store";
import type { DesktopRelinkCandidate } from "../desktop-relink";

const row = (assetId: string) =>
  ({ assetId, verdict: "identical" }) as unknown as DesktopRelinkCandidate;

afterEach(() => useRelinkRequestStore.getState().clear());

it("carries the chosen candidates to whoever owns the dialog", () => {
  useRelinkRequestStore.getState().request([row("a1"), row("a2")]);
  expect(useRelinkRequestStore.getState().rows).toHaveLength(2);
});

it("ignores an empty choice so the dialog never opens on nothing", () => {
  useRelinkRequestStore.getState().request([]);
  expect(useRelinkRequestStore.getState().rows).toBeNull();
});

it("clears after the dialog takes them, so it cannot reopen on its own", () => {
  useRelinkRequestStore.getState().request([row("a1")]);
  useRelinkRequestStore.getState().clear();
  expect(useRelinkRequestStore.getState().rows).toBeNull();
});
