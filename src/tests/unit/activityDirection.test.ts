import { describe, it, expect } from "vitest";
import {
  resolveDirection,
  isAttributed,
  MIN_DIRECTION_CONFIDENCE,
} from "../../utils/activityDirection.js";

describe("resolveDirection — measured sources", () => {
  it("reads direction from an auto-logged inbound email", () => {
    const r = resolveDirection({
      type: "email",
      autoLogged: true,
      header: "Jim Halpert sent you an email",
      actor: "Jim Halpert",
    });
    expect(r.direction).toBe("inbound");
    expect(r.source).toBe("measured_email");
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("reads direction from an auto-logged outbound email", () => {
    const r = resolveDirection({
      type: "email",
      autoLogged: true,
      header: "You sent an email",
      actor: "You",
    });
    expect(r.direction).toBe("outbound");
    expect(r.source).toBe("measured_email");
  });

  it("reads direction from a custom activity type that names it", () => {
    expect(resolveDirection({ type: "phone_call", typeLabel: "Inbound Call" }).direction).toBe("inbound");
    expect(resolveDirection({ type: "phone_call", typeLabel: "Outbound Call" }).direction).toBe("outbound");
    expect(resolveDirection({ type: "phone_call", typeLabel: "Inbound Call" }).source).toBe("measured_type");
  });

  it("prefers a measured source over body-text inference", () => {
    // Body says outbound, but the auto-logged email says inbound. Measured wins.
    const r = resolveDirection({
      type: "email",
      autoLogged: true,
      header: "Jim Halpert sent you an email",
      actor: "Jim Halpert",
      body: "I emailed him the deck",
    });
    expect(r.direction).toBe("inbound");
    expect(r.source).toBe("measured_email");
  });
});

describe("resolveDirection — text inference", () => {
  it("infers inbound when the buyer is the actor", () => {
    for (const body of [
      "They called me this morning about renewal",
      "Jim reached out to us asking for pricing",
      "Reply received — wants a revised quote",
    ]) {
      const r = resolveDirection({ type: "phone_call", body });
      expect(r.direction, body).toBe("inbound");
      expect(r.source).toBe("inferred_text");
    }
  });

  it("infers outbound for rep-initiated phrasing", () => {
    for (const body of [
      "Left a voicemail about the warehouse schedule",
      "I emailed the revised pricing over",
      "Cold call — no answer",
    ]) {
      const r = resolveDirection({ type: "phone_call", body });
      expect(r.direction, body).toBe("outbound");
    }
  });

  it("caps inferred confidence below measured confidence", () => {
    const inferred = resolveDirection({ type: "phone_call", body: "They called me" });
    const measured = resolveDirection({ type: "phone_call", typeLabel: "Inbound Call" });
    expect(inferred.confidence).toBeLessThan(measured.confidence);
    expect(inferred.confidence).toBeLessThanOrEqual(0.8);
  });

  it("always reports which rule fired, so a score stays auditable", () => {
    const r = resolveDirection({ type: "phone_call", body: "They called me this morning" });
    expect(r.evidence).toBeTruthy();
    expect(typeof r.evidence).toBe("string");
  });
});

describe("resolveDirection — refusing to guess", () => {
  it("returns unknown for a note that states no direction", () => {
    // The exact note logged during live verification: it says nothing about who
    // initiated the call, so inventing a direction here would fabricate the 40%
    // dimension outright.
    const r = resolveDirection({
      type: "phone_call",
      body: "Connected call re Q3 paper renewal. Jim asked for revised pricing by Friday.",
      actor: "You",
    });
    expect(r.direction).toBe("unknown");
    expect(r.source).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("returns unknown for empty or missing input", () => {
    expect(resolveDirection({ type: null }).direction).toBe("unknown");
    expect(resolveDirection({ type: "note", body: "" }).direction).toBe("unknown");
    expect(resolveDirection({ type: "note", body: "   " }).direction).toBe("unknown");
  });

  it("does not treat 'logged by the rep' as 'initiated by the rep'", () => {
    // A manually logged activity always has actor "You" — that says who typed
    // it, not who initiated the interaction. It must not imply outbound.
    const r = resolveDirection({
      type: "meeting",
      header: "You logged a Meeting",
      actor: "You",
      body: "Quarterly review",
    });
    expect(r.direction).toBe("unknown");
  });

  it("isAttributed gates unknown out of Exchange", () => {
    expect(isAttributed(resolveDirection({ type: "note", body: "" }))).toBe(false);
    expect(isAttributed(resolveDirection({ type: "phone_call", typeLabel: "Inbound Call" }))).toBe(true);
  });

  it("exposes a usable confidence floor", () => {
    expect(MIN_DIRECTION_CONFIDENCE).toBeGreaterThan(0);
    expect(MIN_DIRECTION_CONFIDENCE).toBeLessThan(1);
  });
});
