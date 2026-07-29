import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ok, fail, okResult, toCallToolResult, errorToResult } from "../../utils/response.js";
import { CopperToolError } from "../../types/errors.js";

function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe("response builders", () => {
  it("ok() produces the canonical success envelope with default source", () => {
    const env = ok("Found 3 people.", { people: [] }, { recordCount: 3 });
    expect(env).toMatchObject({
      success: true,
      message: "Found 3 people.",
      data: { people: [] },
      meta: { source: "copper-web-ui", recordCount: 3 },
    });
  });

  it("fail() produces the canonical error envelope", () => {
    const env = fail("RECORD_NOT_FOUND", "nope", "detail", "/tmp/x.png");
    expect(env).toEqual({
      success: false,
      message: "nope",
      error: { code: "RECORD_NOT_FOUND", details: "detail", artifactPath: "/tmp/x.png" },
    });
  });

  it("toCallToolResult marks errors with isError", () => {
    expect(toCallToolResult(ok("ok", {})).isError).toBe(false);
    expect(toCallToolResult(fail("UNKNOWN", "bad")).isError).toBe(true);
  });

  it("okResult serializes to a text content block", () => {
    const r = okResult("hi", { a: 1 });
    expect(r.content[0].type).toBe("text");
    expect(parseResult(r)).toMatchObject({ success: true, data: { a: 1 } });
  });
});

describe("errorToResult", () => {
  it("maps ZodError to VALIDATION_FAILURE", () => {
    const err = z.object({ x: z.string() }).safeParse({ x: 1 });
    const result = errorToResult((err as { error: z.ZodError }).error);
    const body = parseResult(result);
    expect(result.isError).toBe(true);
    expect(body.error.code).toBe("VALIDATION_FAILURE");
    expect(body.error.details).toContain("x");
  });

  it("preserves CopperToolError code, details, and artifact path", () => {
    const e = new CopperToolError("SELECTOR_FAILURE", "could not find X", "both selectors failed");
    e.artifactPath = "/tmp/shot.png";
    const body = parseResult(errorToResult(e));
    expect(body.error).toEqual({
      code: "SELECTOR_FAILURE",
      details: "both selectors failed",
      artifactPath: "/tmp/shot.png",
    });
  });

  it("maps unknown errors to UNKNOWN", () => {
    const body = parseResult(errorToResult(new Error("boom")));
    expect(body.error.code).toBe("UNKNOWN");
    expect(body.error.details).toBe("boom");
  });
});
