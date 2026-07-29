/**
 * Direction resolution for Copper activities — who initiated the interaction.
 *
 * This is the hardest and most consequential field we extract: PACE weights the
 * Exchange dimension (buyer-initiated ÷ your outreach) at 40% precisely because
 * it is the one number you cannot improve by working harder.
 *
 * ── WHY THIS IS A LADDER, NOT A PARSER ──────────────────────────────────────
 * Copper's built-in activity types (Phone Call, Meeting, To Do, SMS, Note,
 * Email, Form) carry NO direction field — verified live 2026-07-24. A manually
 * logged activity records who *logged* it (always the rep), not who *initiated*
 * the interaction. Direction therefore has three possible provenances:
 *
 *   1. MEASURED  — an auto-logged email from Copper's Google/email integration.
 *                  Direction comes from the correspondence PARTIES (which pill is
 *                  the contact), verified live 2026-07-28 on an email-integrated
 *                  account — see emailDirectionFromParties. Highest confidence.
 *   2. MEASURED  — a custom activity type whose name encodes direction, e.g.
 *                  "Inbound Call" / "Outbound Call". Requires CRM config.
 *   3. INFERRED  — phrasing heuristics over the note body. Depends entirely on
 *                  how reps write notes, so confidence is capped well below 1.
 *
 * Anything that does not clear a rule returns `unknown`. We never guess a
 * direction to fill a gap: an unknown event is excluded from the Exchange
 * numerator and counted separately so the UI can say "3 events could not be
 * attributed" rather than silently depressing someone's score.
 */

export type ActivityDirection = "inbound" | "outbound" | "unknown";

export type DirectionSource =
  | "measured_email"
  | "measured_type"
  | "inferred_text"
  | "unknown";

export interface DirectionResult {
  /** inbound = buyer-initiated; outbound = your outreach touch. */
  direction: ActivityDirection;
  source: DirectionSource;
  /** 0..1. Only `measured_*` sources exceed 0.8. */
  confidence: number;
  /** Which rule fired — surfaced in the UI tooltip so a score is auditable. */
  evidence: string | null;
}

const UNKNOWN: DirectionResult = {
  direction: "unknown",
  source: "unknown",
  confidence: 0,
  evidence: null,
};

/** Below this, callers should treat the result as `unknown`. */
export const MIN_DIRECTION_CONFIDENCE = 0.4;

export interface DirectionInput {
  /** Normalized activity type, e.g. "phone_call" (from classifyActivityHeader). */
  type: string | null;
  /** The raw type label as Copper rendered it, e.g. "Inbound Call". */
  typeLabel?: string | null;
  /** Header phrasing, e.g. "You logged a Phone Call". */
  header?: string | null;
  /** The note/body text of the activity. */
  body?: string | null;
  /** Actor name as rendered; "You" for the signed-in rep. */
  actor?: string | null;
  /** True when the activity was created by Copper's integration, not a human. */
  autoLogged?: boolean;
  /**
   * For an auto-logged email: the direction derived STRUCTURALLY from the
   * sender/recipient pills (see emailDirectionFromParties). When present this is
   * the measured, high-confidence source and supersedes the text heuristics.
   */
  emailDirection?: "inbound" | "outbound" | null;
  /** Human-readable justification for emailDirection, for the audit tooltip. */
  emailEvidence?: string | null;
}

/**
 * Decide an auto-logged email's direction from the correspondence parties.
 *
 * VERIFIED 2026-07-28 on a live email-integrated account: the sender/recipient
 * are AvatarPills; a CRM contact's pill links to `/#/contact/<id>` (or
 * `people-<id>`), while an internal team member's pill has no such link. So:
 *
 *   - the CONTACT is the sender      → inbound  (they wrote to us)
 *   - the CONTACT is a recipient     → outbound (we wrote to them)
 *   - sender is an internal user     → outbound (we sent it)      [fallback]
 *   - sender is some other contact   → inbound  (a contact sent it) [fallback]
 *
 * Returns null when neither party can be classified, so the caller falls through
 * to `unknown` rather than guessing.
 */
export function emailDirectionFromParties(opts: {
  contactId: string;
  senderHref: string | null;
  recipientHref: string | null;
}): { direction: "inbound" | "outbound"; evidence: string } | null {
  const { contactId, senderHref, recipientHref } = opts;
  const isThisContact = (href: string | null): boolean =>
    !!href && new RegExp(`(?:contact/|people-)${contactId}(?:\\D|$)`).test(href);
  const linksToAContact = (href: string | null): boolean =>
    !!href && /\/contact\/\d|people-\d/.test(href);

  // Primary: match the contact whose feed we're reading against the parties.
  if (isThisContact(senderHref)) {
    return { direction: "inbound", evidence: "auto-logged email sent BY this contact" };
  }
  if (isThisContact(recipientHref)) {
    return { direction: "outbound", evidence: "auto-logged email sent TO this contact" };
  }
  // Fallback when the ids don't line up (group threads, alias addresses): an
  // internal sender (no contact link) means we sent it; a contact sender means
  // it came in.
  if (senderHref === null || senderHref === "") {
    return { direction: "outbound", evidence: "auto-logged email; sender is an internal user" };
  }
  if (linksToAContact(senderHref)) {
    return { direction: "inbound", evidence: "auto-logged email; sender is a CRM contact" };
  }
  return null;
}

/**
 * Rule 2 — a custom activity type that names its own direction.
 * VERIFIED that Copper ships no such type by default; this fires only when the
 * account has configured custom types.
 */
function fromTypeLabel(label: string | null | undefined): DirectionResult | null {
  if (!label) return null;
  if (/\b(inbound|incoming|received)\b/i.test(label)) {
    return {
      direction: "inbound",
      source: "measured_type",
      confidence: 0.9,
      evidence: `activity type "${label}" names inbound`,
    };
  }
  if (/\b(outbound|outgoing|sent)\b/i.test(label)) {
    return {
      direction: "outbound",
      source: "measured_type",
      confidence: 0.9,
      evidence: `activity type "${label}" names outbound`,
    };
  }
  return null;
}

/**
 * Rule 1 — an auto-logged email. Copper's email integration records the real
 * sender/recipient, so direction is MEASURED, not inferred.
 *
 * VERIFIED 2026-07-28 against a live email-integrated account. The structural
 * signal (`emailDirection`, computed by emailDirectionFromParties during DOM
 * parsing) is authoritative. The older header/actor phrasing is kept only as a
 * lower-confidence fallback for the rare item where the parties couldn't be read.
 */
function fromAutoLoggedEmail(input: DirectionInput): DirectionResult | null {
  if (!input.autoLogged) return null;
  if (input.type !== "email") return null;

  // Measured: the sender/recipient pills already told us the direction.
  if (input.emailDirection) {
    return {
      direction: input.emailDirection,
      source: "measured_email",
      confidence: 0.95,
      evidence: input.emailEvidence ?? `auto-logged email (${input.emailDirection})`,
    };
  }

  // Fallback: header/actor phrasing when the parties couldn't be classified.
  const header = (input.header ?? "").trim();
  const actor = (input.actor ?? "").trim();

  if (/\bsent you\b|\breplied\b|\bwrote\b/i.test(header)) {
    return {
      direction: "inbound",
      source: "measured_email",
      confidence: 0.8,
      evidence: "auto-logged email addressed to you",
    };
  }
  if (/^you$/i.test(actor)) {
    return {
      direction: "outbound",
      source: "measured_email",
      confidence: 0.8,
      evidence: "auto-logged email sent by you",
    };
  }
  if (actor) {
    return {
      direction: "inbound",
      source: "measured_email",
      confidence: 0.8,
      evidence: `auto-logged email sent by ${actor}`,
    };
  }
  return null;
}

/**
 * Rule 3 — phrasing heuristics over the note body.
 *
 * Ordered most-specific first. Deliberately conservative: a note like
 * "Connected call re renewal" states no direction, so it returns null rather
 * than defaulting to outbound just because the rep logged it.
 */
function fromBodyText(body: string | null | undefined): DirectionResult | null {
  const text = (body ?? "").trim();
  if (!text) return null;

  const inboundRules: Array<[RegExp, number, string]> = [
    [/\b(they|he|she|client|customer|prospect)\s+(called|emailed|messaged|reached out|got in touch|replied|responded|wrote|confirmed|sent)\b/i, 0.75, "buyer named as the actor"],
    [/\b(called|emailed|messaged|reached out to|got in touch with)\s+(me|us)\b/i, 0.75, "contacted me/us"],
    [/\b(inbound|incoming)\b/i, 0.7, "explicitly inbound"],
    // Deliberately does NOT require a follow-word: "They replied asking for the
    // redlines" is a real note that the narrower form missed in live testing.
    [/\breplied\b|\breply\s+received\b|\bgot a reply\b/i, 0.7, "reply received"],
    [/\b(they|he|she)\s+(asked|requested|wants|booked|scheduled)\b/i, 0.65, "buyer asked/requested"],
    [/\bresponded\b/i, 0.6, "responded"],
  ];

  const outboundRules: Array<[RegExp, number, string]> = [
    [/\b(outbound|outreach|cold call|cold email)\b/i, 0.75, "explicitly outbound"],
    [/\bleft (a )?(voicemail|vm|message)\b/i, 0.7, "left a voicemail"],
    [/\bi\s+(called|emailed|messaged|sent|reached out|followed up)\b/i, 0.7, "first-person outreach"],
    [/\b(called|emailed|messaged|reached out to|followed up with)\s+(him|her|them)\b/i, 0.65, "outreach to buyer"],
    [/\bsent\s+(the|a|an|over)\b/i, 0.6, "sent something"],
    [/\bno answer\b|\bdid not pick up\b|\bunanswered\b/i, 0.6, "unanswered outreach"],
  ];

  for (const [re, confidence, evidence] of inboundRules) {
    if (re.test(text)) return { direction: "inbound", source: "inferred_text", confidence, evidence };
  }
  for (const [re, confidence, evidence] of outboundRules) {
    if (re.test(text)) return { direction: "outbound", source: "inferred_text", confidence, evidence };
  }
  return null;
}

/**
 * Resolve direction by walking the ladder: measured sources first, phrasing
 * inference last, `unknown` when nothing fires or confidence is too low.
 */
export function resolveDirection(input: DirectionInput): DirectionResult {
  const result =
    fromAutoLoggedEmail(input) ?? fromTypeLabel(input.typeLabel) ?? fromBodyText(input.body);

  if (!result) return UNKNOWN;
  if (result.confidence < MIN_DIRECTION_CONFIDENCE) return UNKNOWN;
  return result;
}

/** True when this result is trustworthy enough to count in Exchange. */
export function isAttributed(result: DirectionResult): boolean {
  return result.direction !== "unknown";
}
