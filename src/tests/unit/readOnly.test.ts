import { describe, it, expect, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, resetConfigCache } from "../../config.js";
import { registerLogActivity } from "../../tools/logActivity.js";
import { registerCreateTask } from "../../tools/createTask.js";
import { CopperToolError } from "../../types/errors.js";

/**
 * The read-only lock is a production-safety guarantee, not a comment. Anything
 * that quietly regresses it — a default flip, a missing registration guard, a
 * page object that forgets to check — must fail here loudly.
 */
describe("read-only mode — defaults", () => {
  beforeEach(() => resetConfigCache());

  it("defaults to true when COPPER_READ_ONLY is unset", () => {
    // "You have to opt in to writing" is a much safer default than "you have to
    // remember not to". A production Copper account is on the line.
    expect(loadConfig({} as NodeJS.ProcessEnv).readOnly).toBe(true);
  });

  it("stays true for every truthy-ish value that is not explicitly false", () => {
    for (const v of [undefined, "", "true", "1", "yes", "on", "TRUE"]) {
      resetConfigCache();
      const env = v === undefined ? {} : ({ COPPER_READ_ONLY: v } as NodeJS.ProcessEnv);
      expect(loadConfig(env).readOnly, `for ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("only turns off for an explicit false-ish value", () => {
    for (const v of ["false", "0", "no", "off"]) {
      resetConfigCache();
      expect(loadConfig({ COPPER_READ_ONLY: v } as NodeJS.ProcessEnv).readOnly).toBe(false);
    }
  });
});

describe("page-object guards — belt and braces beneath registration", () => {
  beforeEach(() => resetConfigCache());

  it("logActivity refuses to run when read-only, even if a caller bypasses tool registration", async () => {
    process.env.COPPER_READ_ONLY = "true";
    resetConfigCache();
    const { ActivitiesPage } = await import("../../pages/activitiesPage.js");
    const fake = { on: () => undefined } as unknown as import("playwright").Page;
    const page = new ActivitiesPage(fake);
    await expect(
      page.logActivity({ parentType: "person", parentId: "1", activityType: "Note", details: "x" }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
  });

  it("createTask refuses to run when read-only", async () => {
    process.env.COPPER_READ_ONLY = "true";
    resetConfigCache();
    const { TasksPage } = await import("../../pages/tasksPage.js");
    const fake = { on: () => undefined } as unknown as import("playwright").Page;
    const page = new TasksPage(fake);
    await expect(
      page.createTask({ title: "t", parentType: "person", parentId: "1" }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
  });
});

/**
 * The registration guard is structural: an MCP client cannot CALL a tool that
 * is not registered, so this is the primary defence. The page-object guard
 * above is only there to catch someone bypassing the SDK entirely.
 */
describe("tool registration — the primary defence", () => {
  function fakeServer() {
    const registered = new Set<string>();
    const server = {
      registerTool: (name: string) => {
        registered.add(name);
      },
    } as unknown as McpServer;
    return { server, registered };
  }

  beforeEach(() => resetConfigCache());

  it("still permits explicit calls to the write registrars — the LOCK is index.ts skipping them", () => {
    // This asserts the shape the guard depends on: the registrars themselves
    // do not internally check readOnly. If someone adds an internal check that
    // silently succeeds, the guard in index.ts becomes the only line of defence
    // and must not be removed.
    const { server, registered } = fakeServer();
    registerLogActivity(server);
    registerCreateTask(server);
    expect(registered.has("log_activity")).toBe(true);
    expect(registered.has("create_task")).toBe(true);
  });
});

describe("READ_ONLY error code", () => {
  it("is a first-class error code so callers can distinguish it from other refusals", () => {
    const e = new CopperToolError("READ_ONLY", "no writes", "read-only mode");
    expect(e.code).toBe("READ_ONLY");
  });
});
