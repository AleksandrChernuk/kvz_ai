import { z } from "zod"

import { LIMITS } from "./config.js"

// Strict input schemas — reject anything outside bounds. No free-form URLs,
// SQL, file paths, or arbitrary fields (connector-standard).

export const searchInput = z
  .object({
    query: z.string().trim().min(1).max(LIMITS.maxQueryLength),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMITS.maxResults)
      .optional()
      .default(LIMITS.defaultResults),
  })
  .strict()

export const fetchInput = z
  .object({
    // Document ids are slug-like; reject path traversal / arbitrary input.
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{0,127}$/i, "invalid document id"),
  })
  .strict()

export type SearchInput = z.infer<typeof searchInput>
export type FetchInput = z.infer<typeof fetchInput>
