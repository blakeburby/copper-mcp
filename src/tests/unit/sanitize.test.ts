import { describe, it, expect } from "vitest";
import { sanitize } from "../../utils/logger.js";
import { sanitizeHtml } from "../../browser/diagnostics.js";

describe("logger.sanitize", () => {
  it("redacts sensitive keys in objects", () => {
    const out = sanitize({
      name: "Jim",
      password: "hunter2",
      token: "abc",
      nested: { apiKey: "secret", ok: "keep" },
    }) as Record<string, unknown>;
    expect(out.name).toBe("Jim");
    expect(out.password).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).ok).toBe("keep");
  });

  it("redacts inline secrets in strings", () => {
    const out = sanitize("authorization: Bearer xyz123; other=1") as string;
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("xyz123");
  });

  it("recurses through arrays", () => {
    const out = sanitize([{ secret: "s" }, "cookie=abc"]) as unknown[];
    expect((out[0] as Record<string, unknown>).secret).toBe("[REDACTED]");
    expect(out[1]).toContain("[REDACTED]");
  });
});

describe("diagnostics.sanitizeHtml", () => {
  it("blanks input values", () => {
    const html = `<input name="email" value="jim@dunder.com">`;
    expect(sanitizeHtml(html)).not.toContain("jim@dunder.com");
    expect(sanitizeHtml(html)).toContain("[REDACTED]");
  });

  it("removes password fields and inline scripts", () => {
    const html = `<input type="password" value="hunter2"><script>var t='secret'</script>`;
    const out = sanitizeHtml(html);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("secret");
    expect(out).toContain("<script>[REDACTED]</script>");
  });
});
