import { z } from "zod";
import { readDesktopMediaBridge } from "./source/desktop-media-bridge";

// Gather referenced originals into one folder. Copies and verifies before
// re-pointing, and never deletes an original.
// See docs/decisions/2026-09-08-library-model.md.

const resultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: z.object({
      moved: z.array(
        z.object({
          assetId: z.string().min(1),
          relativePath: z.string().optional(),
          alreadyThere: z.boolean().optional(),
        }),
      ),
      failed: z.array(z.object({ assetId: z.string().min(1), code: z.string().min(1) })),
      cancelled: z.boolean(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export type ConsolidateOutcome = Extract<
  z.infer<typeof resultSchema>,
  { ok: true }
>["result"];

export class ConsolidateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConsolidateError";
    this.code = code;
  }
}

export const canConsolidate = (): boolean => Boolean(readDesktopMediaBridge()?.consolidate);

export const parseConsolidateResult = (value: unknown): ConsolidateOutcome => {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConsolidateError("INVALID_RESPONSE", "The desktop app returned an invalid response.");
  }
  if (!parsed.data.ok) throw new ConsolidateError(parsed.data.error.code, parsed.data.error.message);
  return parsed.data.result;
};

export const consolidateAssets = async (
  assetIds: readonly string[],
): Promise<ConsolidateOutcome> => {
  const bridge = readDesktopMediaBridge();
  if (!bridge?.consolidate) {
    throw new ConsolidateError(
      "DESKTOP_REQUIRED",
      "Gathering originals requires the Movie Desk macOS app.",
    );
  }
  return parseConsolidateResult(await bridge.consolidate([...assetIds]));
};
