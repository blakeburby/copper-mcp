import { describe, it, expect } from "vitest";
import {
  parentRefSchema,
  parentTypeSchema,
  limitSchema,
  querySchema,
  dateStringSchema,
  confirmSchema,
} from "../../schemas/common.js";

describe("common schemas", () => {
  it("parentTypeSchema accepts the four valid types and rejects others", () => {
    for (const t of ["person", "company", "opportunity", "lead"]) {
      expect(parentTypeSchema.parse(t)).toBe(t);
    }
    expect(parentTypeSchema.safeParse("account").success).toBe(false);
  });

  it("parentRefSchema requires a non-empty id and a valid type", () => {
    expect(parentRefSchema.parse({ parentType: "person", parentId: "123" })).toEqual({
      parentType: "person",
      parentId: "123",
    });
    expect(parentRefSchema.safeParse({ parentType: "person", parentId: "" }).success).toBe(false);
    expect(parentRefSchema.safeParse({ parentType: "x", parentId: "1" }).success).toBe(false);
  });

  it("limitSchema defaults to 20 and caps at 100", () => {
    expect(limitSchema.parse(undefined)).toBe(20);
    expect(limitSchema.parse(5)).toBe(5);
    expect(limitSchema.safeParse(0).success).toBe(false);
    expect(limitSchema.safeParse(101).success).toBe(false);
    expect(limitSchema.safeParse(2.5).success).toBe(false);
  });

  it("querySchema trims and rejects empty", () => {
    expect(querySchema.parse("  hello  ")).toBe("hello");
    expect(querySchema.safeParse("   ").success).toBe(false);
  });

  it("dateStringSchema enforces YYYY-MM-DD", () => {
    expect(dateStringSchema.parse("2026-07-24")).toBe("2026-07-24");
    expect(dateStringSchema.safeParse("07/24/2026").success).toBe(false);
    expect(dateStringSchema.safeParse("2026-7-4").success).toBe(false);
  });

  it("confirmSchema defaults to false", () => {
    expect(confirmSchema.parse(undefined)).toBe(false);
    expect(confirmSchema.parse(true)).toBe(true);
  });
});
