import { describe, it, expect } from "vitest";
import {
  mapCompositeItem,
  mapCompositeItems,
  extractCompositeItems,
  type CompositeActivityItem,
} from "../../utils/compositeActivity.js";

/**
 * Fixtures are the REAL shapes captured 2026-07-28 from
 * contacts_api/<id>/activity_log_composite on a live account (Miniac).
 */
const inboundEmail: CompositeActivityItem = {
  activity_type: 6,
  actor: { id: null, entity_type: 10 },
  source_id: 181215998,
  target_id: 1492557212,
  company_user_id: -3,
  text: "Re: Gatorade debrief — Hey…",
  timestamp: 1785299012,
  template_string: "{{target_sender}} to {{target_recipient}}",
};
const outboundEmail: CompositeActivityItem = {
  activity_type: 6,
  actor: { id: 1223419, entity_type: 10 },
  source_id: 181215998,
  target_id: 1492423244,
  company_user_id: 1223419,
  text: "Estimate confirmation",
  timestamp: 1785263843,
  template_string: "{{target_sender}} to {{target_recipient}}",
};
const meeting: CompositeActivityItem = {
  activity_type: 35,
  actor: { id: 1223418, entity_type: 10 },
  company_user_id: 1223418,
  timestamp: 1784849400,
  template_string: "Meeting with {{meeting_with_contacts}}",
};
const systemAdd: CompositeActivityItem = {
  activity_type: 8,
  actor: { id: 1223419, entity_type: 10 },
  company_user_id: 1223419,
  timestamp: 1773099999,
  template_string: "{{actor}} added this {{source_type}}",
};

describe("mapCompositeItem — email direction is measured from Copper's own data", () => {
  it("external sender (actor.id null) → INBOUND", () => {
    const a = mapCompositeItem(inboundEmail);
    expect(a.type).toBe("email");
    expect(a.direction).toBe("inbound");
    expect(a.directionSource).toBe("measured_email");
    expect(a.actorKind).toBe("other");
    expect(a.channel).toBe("email");
    expect(a.occurredAtIso).toBe("2026-07-29T04:23:32.000Z");
  });

  it("internal user as actor → OUTBOUND", () => {
    const a = mapCompositeItem(outboundEmail);
    expect(a.direction).toBe("outbound");
    expect(a.directionSource).toBe("measured_email");
    expect(a.actorKind).toBe("self");
  });
});

describe("mapCompositeItem — other types", () => {
  it("meeting → outbound (attended, conservative), never dropped", () => {
    const a = mapCompositeItem(meeting);
    expect(a.type).toBe("meeting");
    expect(a.direction).toBe("outbound");
    expect(a.channel).toBe("in_person");
  });

  it("system 'added record' → actorKind system (skipped downstream)", () => {
    const a = mapCompositeItem(systemAdd);
    expect(a.actorKind).toBe("system");
    expect(a.type).toBe("record_created");
  });

  it("unrecognised type → unknown direction, counted not guessed", () => {
    const a = mapCompositeItem({ activity_type: 999, timestamp: 1785000000 });
    expect(a.type).toBeNull();
    expect(a.direction).toBe("unknown");
    expect(a.actorKind).toBe("unknown");
    // still carries a timestamp so it isn't dropped as undated
    expect(a.occurredAtIso).not.toBeNull();
  });

  it("handles epoch-ms timestamps as well as seconds", () => {
    const secs = mapCompositeItem({ activity_type: 6, actor: { id: null }, timestamp: 1785299012 });
    const ms = mapCompositeItem({ activity_type: 6, actor: { id: null }, timestamp: 1785299012000 });
    expect(secs.occurredAtIso).toBe(ms.occurredAtIso);
  });

  it("missing timestamp → null occurredAtIso (dropped downstream, never dated to now)", () => {
    expect(mapCompositeItem({ activity_type: 6, actor: { id: null } }).occurredAtIso).toBeNull();
  });
});

describe("extractCompositeItems — envelope shapes", () => {
  it("accepts a bare array", () => {
    expect(extractCompositeItems([inboundEmail])).toHaveLength(1);
  });
  it("accepts {activity_logs:[...]} and {documents:[...]}", () => {
    expect(extractCompositeItems({ activity_logs: [inboundEmail] })).toHaveLength(1);
    expect(extractCompositeItems({ documents: [meeting, systemAdd] })).toHaveLength(2);
  });
  it("returns [] for an unrecognised shape (never throws)", () => {
    expect(extractCompositeItems({ nope: 1 })).toEqual([]);
    expect(extractCompositeItems(null)).toEqual([]);
  });
});

describe("mapCompositeItems batch mirrors the sampled mix", () => {
  it("maps a real 4-item mix into events vs touches vs skips correctly", () => {
    const mapped = mapCompositeItems([inboundEmail, outboundEmail, meeting, systemAdd]);
    expect(mapped.map((m) => m.direction)).toEqual(["inbound", "outbound", "outbound", "unknown"]);
    expect(mapped.map((m) => m.actorKind)).toEqual(["other", "self", "self", "system"]);
  });
});
