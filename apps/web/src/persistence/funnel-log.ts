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
  z.object({ event: z.literal("undo"), data: z.object({}).strict() }),
  z.object({ event: z.literal("command"), data: z.object({}).strict() }),
  z.object({
    event: z.literal("recovery"),
    data: z
      .object({
        kind: z.enum(["relink", "snapshot", "save-conflict", "import-retry"]),
        result: z.enum(["pending", "success", "abandoned"]),
        hintVisible: z.boolean(),
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
export const trimFunnelRows = (
  rows: readonly FunnelRow[],
  perProject = PROJECT_LIMIT,
  total = TOTAL_LIMIT,
): FunnelRow[] => {
  const counts = new Map<string, number>();
  return [...rows]
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    .filter((row) => {
      const n = (counts.get(row.projectId) ?? 0) + 1;
      counts.set(row.projectId, n);
      return n <= perProject;
    })
    .slice(0, total)
    .reverse();
};
class FunnelDB extends Dexie {
  rows!: Table<FunnelRow, string>;
  constructor() {
    super("movie-desk.funnel.v1");
    this.version(1).stores({ rows: "id, projectId, at, [projectId+at]" });
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
  writes = writes
    .catch(() => {})
    .then(async () => {
      if (epoch !== generation || batch.length === 0) return;
      try {
        const database = getDb();
        await database.transaction("rw", database.rows, async () => {
          await database.rows.bulkAdd(batch);
          for (const projectId of new Set(batch.map((row) => row.projectId))) {
            const excess =
              (await database.rows.where("projectId").equals(projectId).count()) - PROJECT_LIMIT;
            if (excess > 0) {
              const oldest = await database.rows
                .where("[projectId+at]")
                .between([projectId, Dexie.minKey], [projectId, Dexie.maxKey])
                .limit(excess)
                .primaryKeys();
              await database.rows.bulkDelete(oldest);
            }
          }
          const excess = (await database.rows.count()) - TOTAL_LIMIT;
          if (excess > 0)
            await database.rows.bulkDelete(
              await database.rows.orderBy("at").limit(excess).primaryKeys(),
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
