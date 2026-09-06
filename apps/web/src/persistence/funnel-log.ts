import Dexie, { type Table } from "dexie";
import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const funnelEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("start"), data: z.object({ baseline: z.boolean() }).strict() }),
  z.object({
    event: z.literal("path"),
    data: z.object({ path: z.enum(["organize", "manual", "guided"]) }).strict(),
  }),
  z.object({ event: z.literal("import"), data: z.object({ baseline: z.boolean() }).strict() }),
  z.object({ event: z.literal("clip"), data: z.object({ baseline: z.boolean() }).strict() }),
  z.object({ event: z.literal("export-start"), data: z.object({}).strict() }),
  z.object({
    event: z.literal("export-success"),
    data: z.object({ assets: count, clips: count }).strict(),
  }),
  z.object({
    event: z.literal("export-failure"),
    data: z.object({ cancelled: z.boolean() }).strict(),
  }),
  z.object({
    event: z.literal("activity"),
    data: z.object({ commands: count, undos: count }).strict(),
  }),
  z.object({ event: z.literal("undo"), data: z.object({}).strict() }),
  z.object({ event: z.literal("command"), data: z.object({}).strict() }),
  z.object({
    event: z.literal("recovery"),
    data: z
      .object({
        kind: z.enum(["relink", "snapshot", "save-conflict", "import-retry"]),
        result: z.enum(["pending", "success", "abandoned"]),
        hintVisible: z.boolean(),
        episode: count.optional(),
        assets: count.optional(),
        resolved: count.optional(),
      })
      .strict(),
  }),
]);
export type FunnelEvent = z.infer<typeof funnelEventSchema>;
export type FunnelRow = FunnelEvent & { id: string; projectId: string; at: number };
const identity = z.object({
  id: z.string().uuid(),
  projectId: z.string().regex(/^[a-f0-9]{64}$/),
  at: count,
});
export const parseFunnelRow = (input: unknown): FunnelRow | null => {
  const base = identity.safeParse(input);
  const event = funnelEventSchema.safeParse(input);
  return base.success && event.success ? { ...base.data, ...event.data } : null;
};
export const PROJECT_LIMIT = 1000;
export const TOTAL_LIMIT = 5000;
let funnelLimits = { perProject: PROJECT_LIMIT, total: TOTAL_LIMIT };
// Tests exercise the same IndexedDB retention path with small fixtures.
export const setFunnelLimitsForTests = (
  limits = { perProject: PROJECT_LIMIT, total: TOTAL_LIMIT },
): void => {
  funnelLimits = limits;
};
type FunnelRetentionRow = Pick<FunnelRow, "id" | "projectId" | "at" | "event">;
export const trimFunnelRows = <T extends FunnelRetentionRow>(
  rows: readonly T[],
  perProject = PROJECT_LIMIT,
  total = TOTAL_LIMIT,
): T[] => {
  const protectedEvents = new Set([
    "start",
    "path",
    "import",
    "clip",
    "export-start",
    "export-success",
    "export-failure",
    "recovery",
  ]);
  const protectedRows = rows.filter((row) => protectedEvents.has(row.event));
  const counts = new Map<string, number>();
  for (const row of protectedRows) counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
  const activity = [...rows]
    .filter((row) => !protectedEvents.has(row.event))
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    .filter((row) => {
      const n = (counts.get(row.projectId) ?? 0) + 1;
      counts.set(row.projectId, n);
      return n <= perProject;
    })
    .slice(0, Math.max(0, total - protectedRows.length));
  return [...protectedRows, ...activity].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
};
class FunnelDB extends Dexie {
  rows!: Table<FunnelRow, string>;
  constructor() {
    super("movie-desk.funnel.v1");
    this.version(1).stores({ rows: "id, projectId, at, [projectId+at]" });
    // Retention reads index keys only, without loading event payloads.
    this.version(2).stores({
      rows: "id, projectId, at, [projectId+at], [projectId+at+event+id]",
    });
  }
}
let db: FunnelDB | undefined;
const getDb = () => {
  if (!db) db = new FunnelDB();
  return db;
};
let queue: FunnelRow[] = [];
let scheduled = false;
let generation = 0;
let writes: Promise<void> = Promise.resolve();
export const discardFunnelQueue = () => {
  generation++;
  queue = [];
};
export const flushFunnelLog = (): Promise<void> => {
  const batch = queue;
  queue = [];
  const epoch = generation;
  const { perProject, total } = funnelLimits;
  writes = writes
    .catch(() => {})
    .then(async () => {
      if (epoch !== generation || batch.length === 0) return;
      try {
        const database = getDb();
        await database.transaction("rw", database.rows, async () => {
          await database.rows.bulkAdd(batch);
          const totalCount = await database.rows.count();
          let needsTrim = totalCount > total;
          if (!needsTrim) {
            for (const projectId of new Set(batch.map((row) => row.projectId))) {
              if ((await database.rows.where("projectId").equals(projectId).count()) > perProject) {
                needsTrim = true;
                break;
              }
            }
          }
          if (!needsTrim) return;
          const keys = await database.rows.orderBy("[projectId+at+event+id]").keys();
          const rows = keys.map((key) => {
            const [projectId, at, event, id] = key as unknown as [
              string,
              number,
              FunnelRow["event"],
              string,
            ];
            return { projectId, at, event, id };
          });
          const keep = new Set(trimFunnelRows(rows, perProject, total).map((row) => row.id));
          await database.rows.bulkDelete(
            rows.filter((row) => !keep.has(row.id)).map((row) => row.id),
          );
        });
      } catch {
        /* Measurement never blocks the editor. */
      }
    });
  return writes;
};
export const appendFunnelRow = (input: unknown): void => {
  try {
    const row = parseFunnelRow(input);
    if (!row) return;
    queue.push(row);
    if (queue.length >= 50) void flushFunnelLog();
    if (scheduled) return;
    scheduled = true;
    const flush = () => {
      scheduled = false;
      void flushFunnelLog();
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(flush, { timeout: 1000 });
    else setTimeout(flush, 0);
  } catch {
    /* Even unavailable scheduling/storage cannot affect editing. */
  }
};
export const readFunnelRows = async (): Promise<FunnelRow[]> => {
  await flushFunnelLog();
  try {
    const rows = await getDb().rows.toArray();
    const result: FunnelRow[] = [];
    for (let index = 0; index < rows.length; index++) {
      const valid = parseFunnelRow(rows[index]);
      if (valid) result.push(valid);
      if (index % 100 === 99) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return result;
  } catch {
    return [];
  }
};
export const clearFunnelLog = async (): Promise<boolean> => {
  discardFunnelQueue();
  const clearing = writes
    .catch(() => {})
    .then(async () => {
      try {
        await getDb().rows.clear();
        return true;
      } catch {
        return false;
      }
    });
  writes = clearing.then(() => {});
  return clearing;
};
