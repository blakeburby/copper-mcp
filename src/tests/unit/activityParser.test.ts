import { describe, it, expect } from "vitest";
import {
  parseActivityTimestamp,
  classifyActivityHeader,
  actionPhrase,
} from "../../utils/activityParser.js";

describe("parseActivityTimestamp", () => {
  it("parses the ISO datetime attribute Copper renders", () => {
    // VERIFIED live 2026-07-24: <time datetime="2026-07-24T21:30:39.000Z">2:30 PM</time>
    expect(parseActivityTimestamp("2026-07-24T21:30:39.000Z")).toBe("2026-07-24T21:30:39.000Z");
  });

  it("normalizes offset timestamps to UTC", () => {
    expect(parseActivityTimestamp("2026-07-24T14:30:39-07:00")).toBe("2026-07-24T21:30:39.000Z");
  });

  it("returns null rather than guessing when absent or unparseable", () => {
    expect(parseActivityTimestamp(null)).toBeNull();
    expect(parseActivityTimestamp(undefined)).toBeNull();
    expect(parseActivityTimestamp("")).toBeNull();
    // The human-readable text must never be relied on — it has no date.
    expect(parseActivityTimestamp("2:30 PM")).toBeNull();
  });
});

describe("classifyActivityHeader", () => {
  it("classifies a logged phone call with its channel", () => {
    const m = classifyActivityHeader("You logged a Phone Call", "You");
    expect(m.type).toBe("phone_call");
    expect(m.channel).toBe("phone");
    expect(m.actorKind).toBe("self");
    expect(m.confidence).toBeGreaterThan(0.9);
  });

  it("distinguishes the signed-in user from another actor", () => {
    expect(classifyActivityHeader("You logged a Phone Call", "You").actorKind).toBe("self");
    expect(classifyActivityHeader("Jim Halpert replied by email", "Jim Halpert").actorKind).toBe("other");
    expect(classifyActivityHeader("Someone did a thing", null).actorKind).toBe("unknown");
  });

  it("marks system/audit entries so they are not read as buyer signal", () => {
    // VERIFIED live: these two appear on every freshly created record.
    for (const h of ["You assigned this to You", "You added this Person"]) {
      expect(classifyActivityHeader(h, "You").actorKind).toBe("system");
    }
    expect(classifyActivityHeader("You added this Person", "You").type).toBe("record_created");
  });

  it("maps each known channel", () => {
    expect(classifyActivityHeader("You sent an email", "You").channel).toBe("email");
    expect(classifyActivityHeader("Sent a LinkedIn message", null).channel).toBe("linkedin");
    expect(classifyActivityHeader("You logged a Meeting", "You").channel).toBe("in_person");
  });

  it("falls back to low confidence instead of fabricating a type", () => {
    const m = classifyActivityHeader("Something entirely unrecognised", "You");
    expect(m.type).toBe("unknown");
    expect(m.channel).toBeNull();
    expect(m.confidence).toBeLessThan(0.5);
  });

  it("returns zero confidence for an empty header", () => {
    const m = classifyActivityHeader("", "You");
    expect(m.type).toBeNull();
    expect(m.confidence).toBe(0);
  });

  it("always flags phrasing-derived classification as inferred", () => {
    expect(classifyActivityHeader("You logged a Phone Call", "You").inferred).toBe(true);
  });
});

describe("actionPhrase", () => {
  it("strips the actor prefix", () => {
    expect(actionPhrase("You logged a Phone Call", "You")).toBe("logged a Phone Call");
  });

  it("leaves the header intact when it does not start with the actor", () => {
    expect(actionPhrase("logged a Phone Call", "Jim")).toBe("logged a Phone Call");
  });

  it("handles empty input", () => {
    expect(actionPhrase("", "You")).toBeNull();
    expect(actionPhrase(null, null)).toBeNull();
  });
});
