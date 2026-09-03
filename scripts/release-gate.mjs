#!/usr/bin/env node
// Release gate (work order B24). Runs the checks a release candidate must pass
// in the order ci.yml runs them, then prints one summary so a human or an agent
// can paste the result into the work order without re-reading seven logs.
//
//   node scripts/release-gate.mjs                    # every step, stop at the first failure
//   node scripts/release-gate.mjs --continue         # keep going and report every failure
//   node scripts/release-gate.mjs --skip e2e,build   # leave slow steps out
//   node scripts/release-gate.mjs --only lint,test   # run a subset
//   node scripts/release-gate.mjs --report gate.md   # also write the summary as markdown
//
// The step list is the single source of truth for "green locally == green in
// CI"; keep it aligned with .github/workflows/ci.yml when either changes.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Playwright web server binds this port and refuses to reuse a stranger.
export const E2E_PORT = 32119;

// Ordered like ci.yml: cheapest signal first, browser run last. `build` writes
// to a private dist dir so the developer's `next dev` cache survives the gate.
export const STEPS = [
  { id: "versions", label: "version policy", command: ["pnpm", "check:versions"] },
  { id: "lint", label: "lint", command: ["pnpm", "lint"] },
  { id: "typecheck", label: "typecheck", command: ["pnpm", "typecheck"] },
  { id: "test", label: "unit tests", command: ["pnpm", "test"] },
  { id: "audit", label: "OSV audit (network)", command: ["pnpm", "audit:prod"] },
  {
    id: "build",
    label: "web production build",
    command: ["pnpm", "--filter", "@movie-desk/web", "build"],
    env: { NEXT_DIST_DIR: ".next-gate" },
  },
  {
    id: "e2e",
    label: "browser e2e",
    command: ["pnpm", "test:e2e"],
    precondition: "e2ePortFree",
  },
];

const splitList = (value) =>
  String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

// Parses argv into { continueOnFailure, skip, only, report }. Unknown flags
// are an error so a typo like `--skipp e2e` does not silently run everything.
export const parseArgs = (argv) => {
  const options = { continueOnFailure: false, skip: [], only: [], report: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--continue") {
      options.continueOnFailure = true;
    } else if (arg === "--skip" || arg === "--only" || arg === "--report") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === "--skip") options.skip = [...options.skip, ...splitList(value)];
      else if (arg === "--only") options.only = [...options.only, ...splitList(value)];
      else options.report = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
};

// Applies --only/--skip to STEPS and rejects ids that do not exist.
export const planSteps = ({ skip = [], only = [] } = {}, steps = STEPS) => {
  const known = new Set(steps.map((step) => step.id));
  const unknown = [...skip, ...only].filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown step(s): ${unknown.join(", ")}`);
  const wanted = only.length > 0 ? new Set(only) : known;
  return steps.filter((step) => wanted.has(step.id) && !skip.includes(step.id));
};

const isPortFree = (port) =>
  new Promise((resolvePort) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => resolvePort(true));
  });

// Preconditions return null when satisfied or a human-readable reason.
export const PRECONDITIONS = {
  e2ePortFree: async () =>
    (await isPortFree(E2E_PORT))
      ? null
      : `port ${E2E_PORT} is in use — stop the leftover server (lsof -ti :${E2E_PORT} | xargs kill)`,
};

const runCommand = (step, root) =>
  new Promise((resolveRun) => {
    const [file, ...args] = step.command;
    const child = spawn(file, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...(step.env ?? {}) },
    });
    child.once("error", (error) => resolveRun({ ok: false, detail: error.message }));
    child.once("exit", (code, signal) =>
      resolveRun(
        code === 0
          ? { ok: true, detail: "" }
          : { ok: false, detail: signal ? `signal ${signal}` : `exit code ${code}` },
      ),
    );
  });

// Runs the planned steps. `run` and `preconditions` are injectable so tests
// never spawn pnpm. Each result is { id, label, status, ms, detail } with
// status "pass" | "fail" | "blocked" | "skipped".
export const runGate = async (
  steps,
  { continueOnFailure = false, run, preconditions = PRECONDITIONS, now = Date.now, log } = {},
) => {
  const results = [];
  let failed = false;
  for (const step of steps) {
    if (failed && !continueOnFailure) {
      results.push({ id: step.id, label: step.label, status: "skipped", ms: 0, detail: "" });
      continue;
    }
    log?.(`\n▶ ${step.label} (${step.command.join(" ")})\n`);
    const started = now();
    const blocker = step.precondition ? await preconditions[step.precondition]() : null;
    const outcome = blocker ? { ok: false, detail: blocker } : await run(step);
    const status = blocker ? "blocked" : outcome.ok ? "pass" : "fail";
    if (status !== "pass") failed = true;
    results.push({ id: step.id, label: step.label, status, ms: now() - started, ...outcome });
  }
  return { ok: !failed, results };
};

const formatDuration = (ms) => (ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${ms}ms`);

const MARK = { pass: "✅", fail: "❌", blocked: "⛔", skipped: "⏭" };

// Markdown table that reads the same in a terminal and in docs/07.
export const formatSummary = ({ ok, results }) => {
  const rows = results.map(
    (r) =>
      `| ${MARK[r.status]} ${r.status} | ${r.label} | ${formatDuration(r.ms)} | ${r.detail ?? ""} |`,
  );
  return [
    `Release gate: ${ok ? "PASS" : "FAIL"}`,
    "",
    "| result | step | time | detail |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let options;
  let steps;
  try {
    options = parseArgs(process.argv.slice(2));
    steps = planSteps(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  const outcome = await runGate(steps, {
    continueOnFailure: options.continueOnFailure,
    run: (step) => runCommand(step, root),
    log: (line) => process.stdout.write(line),
  });
  const summary = formatSummary(outcome);
  process.stdout.write(`\n${summary}`);
  if (options.report) writeFileSync(resolve(root, options.report), summary);
  process.exit(outcome.ok ? 0 : 1);
}
