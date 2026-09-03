import assert from "node:assert/strict";
import { test } from "node:test";
import { STEPS, formatSummary, parseArgs, planSteps, runGate } from "./release-gate.mjs";

test("parseArgs reads --continue, --skip, --only and --report", () => {
  const options = parseArgs([
    "--continue",
    "--skip",
    "e2e,build",
    "--only",
    "lint",
    "--report",
    "g.md",
  ]);
  assert.equal(options.continueOnFailure, true);
  assert.deepEqual(options.skip, ["e2e", "build"]);
  assert.deepEqual(options.only, ["lint"]);
  assert.equal(options.report, "g.md");
});

test("parseArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseArgs(["--skipp", "e2e"]), /unknown argument/);
  assert.throws(() => parseArgs(["--skip"]), /needs a value/);
});

test("planSteps keeps CI order, honours --only/--skip and rejects unknown ids", () => {
  assert.deepEqual(
    planSteps().map((s) => s.id),
    ["install", "versions", "lint", "typecheck", "test", "audit", "build", "browsers", "e2e"],
  );
  assert.deepEqual(
    planSteps({ skip: ["e2e", "build", "browsers"] }).map((s) => s.id),
    ["install", "versions", "lint", "typecheck", "test", "audit"],
  );
  assert.deepEqual(
    planSteps({ only: ["test", "lint"] }).map((s) => s.id),
    ["lint", "test"],
  );
  assert.throws(() => planSteps({ skip: ["e2e2"] }), /unknown step\(s\): e2e2/);
});

const fakeSteps = [
  { id: "a", label: "A", command: ["a"] },
  { id: "b", label: "B", command: ["b"], precondition: "portFree" },
  { id: "c", label: "C", command: ["c"] },
];

test("runGate stops after the first failure and marks the rest skipped", async () => {
  const ran = [];
  const outcome = await runGate(fakeSteps, {
    run: async (step) => {
      ran.push(step.id);
      return step.id === "a" ? { ok: false, detail: "exit code 1" } : { ok: true, detail: "" };
    },
    preconditions: { portFree: async () => null },
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(ran, ["a"]);
  assert.deepEqual(
    outcome.results.map((r) => r.status),
    ["fail", "skipped", "skipped"],
  );
});

test("runGate --continue runs every step and reports each failure", async () => {
  const outcome = await runGate(fakeSteps, {
    continueOnFailure: true,
    run: async (step) =>
      step.id === "a" ? { ok: false, detail: "exit code 1" } : { ok: true, detail: "" },
    preconditions: { portFree: async () => null },
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(
    outcome.results.map((r) => r.status),
    ["fail", "pass", "pass"],
  );
});

test("a failed precondition blocks the step without running its command", async () => {
  const ran = [];
  const outcome = await runGate(fakeSteps, {
    continueOnFailure: true,
    run: async (step) => {
      ran.push(step.id);
      return { ok: true, detail: "" };
    },
    preconditions: { portFree: async () => "port busy" },
  });
  assert.deepEqual(ran, ["a", "c"]);
  const blocked = outcome.results.find((r) => r.id === "b");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.detail, "port busy");
  assert.equal(outcome.ok, false);
});

test("formatSummary renders a markdown table with the overall verdict", async () => {
  const ticks = [0, 1_500];
  const outcome = await runGate(fakeSteps.slice(0, 1), {
    run: async () => ({ ok: true, detail: "" }),
    now: () => ticks.shift() ?? 3_000,
  });
  const summary = formatSummary(outcome);
  assert.match(summary, /^Release gate: PASS\n/);
  assert.match(summary, /\| ✅ pass \| A \| 1\.5s \| {2}\|/);
});

test("every real step has a pnpm command and a known precondition", () => {
  for (const step of STEPS) {
    assert.equal(step.command[0], "pnpm", step.id);
    if (step.precondition) assert.equal(step.precondition, "e2ePortFree", step.id);
  }
});
