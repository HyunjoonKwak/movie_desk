import type { MediaFilterSpec } from "@movie-desk/core";
import { z } from "zod";
import { DEFAULT_FILTERS, type MediaFilters } from "./search";

// A smart collection stores its filters as a loose spec so older builds can
// still open the project. Loading validates field by field: an unknown or
// malformed value falls back to the default for that field instead of
// rejecting the whole collection.
const specSchema = z.object({
  kind: z.enum(["all", "video", "audio", "image"]).catch(DEFAULT_FILTERS.kind),
  duration: z.enum(["any", "short", "medium", "long"]).catch(DEFAULT_FILTERS.duration),
  resolution: z.enum(["any", "sd", "hd", "fhd", "uhd"]).catch(DEFAULT_FILTERS.resolution),
  period: z.enum(["any", "today", "week", "month", "year"]).catch(DEFAULT_FILTERS.period),
  place: z.string().nullable().catch(null),
  audio: z.enum(["any", "with", "without"]).catch(DEFAULT_FILTERS.audio),
  tags: z.array(z.string()).readonly().catch([]),
  minRating: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .catch(0),
  favorite: z.boolean().catch(false),
  usage: z.enum(["any", "used", "unused"]).catch(DEFAULT_FILTERS.usage),
});

export const filtersFromSpec = (spec: MediaFilterSpec): MediaFilters => {
  const parsed = specSchema.parse({ ...DEFAULT_FILTERS, ...spec });
  // A smart collection is a search, never a membership list: the collection
  // filter is not part of a saved spec.
  return { ...parsed, collection: null };
};

export const filtersToSpec = (filters: MediaFilters): MediaFilterSpec => {
  const { collection: _membership, ...rest } = filters;
  return rest;
};
