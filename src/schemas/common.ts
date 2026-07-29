/**
 * Shared Zod schemas reused across tool input definitions. Keeping these in one
 * place makes validation behavior consistent (and testable) across tools.
 */
import { z } from "zod";

export const parentTypeSchema = z
  .enum(["person", "company", "opportunity", "lead"])
  .describe("The kind of Copper record this refers to.");

/** A reference to a parent record: its type plus an id (as a string). */
export const parentRefSchema = z
  .object({
    parentType: parentTypeSchema,
    parentId: z
      .string()
      .min(1)
      .describe("Copper record id (as shown in the record URL)."),
  })
  .describe("The Copper record a write is attached to.");

export const limitSchema = z
  .number()
  .int()
  .positive()
  .max(100)
  .default(20)
  .describe("Maximum number of records to return (1-100, default 20).");

export const querySchema = z
  .string()
  .trim()
  .min(1, "query must not be empty")
  .describe("Free-text search query.");

/** ISO-ish date string (YYYY-MM-DD). Kept loose; Copper parses many formats. */
export const dateStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
  .describe("Date in YYYY-MM-DD format.");

export const confirmSchema = z
  .boolean()
  .default(false)
  .describe(
    "Safety gate for writes. When false (default) the tool returns a preview and does NOT submit. Set true to actually write.",
  );

export type ParentRef = z.infer<typeof parentRefSchema>;
