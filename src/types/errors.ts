/**
 * Structured error taxonomy shared across the whole server. Every failure a tool
 * reports maps to exactly one of these codes so agents can branch on the cause.
 */
export type CopperErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "RECORD_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "SELECTOR_FAILURE"
  | "NAVIGATION_FAILURE"
  | "AMBIGUOUS_RESULT"
  | "VALIDATION_FAILURE"
  | "UNEXPECTED_UI"
  | "BROWSER_FAILURE"
  | "CONFIRMATION_REQUIRED"
  | "UNKNOWN";

/**
 * The single error type thrown throughout the server. Page objects and managers
 * throw these; the tool wrapper turns them into a structured error envelope.
 */
export class CopperToolError extends Error {
  readonly code: CopperErrorCode;
  readonly details?: string;
  /** Path to a diagnostics artifact (screenshot) if one was captured. */
  artifactPath?: string;

  constructor(code: CopperErrorCode, message: string, details?: string) {
    super(message);
    this.name = "CopperToolError";
    this.code = code;
    this.details = details;
  }
}

export function isCopperToolError(e: unknown): e is CopperToolError {
  return e instanceof CopperToolError;
}

/** Convenience constructors for the most common cases. */
export const errors = {
  auth(details?: string): CopperToolError {
    return new CopperToolError(
      "AUTHENTICATION_REQUIRED",
      "Copper login is required.",
      details ?? "Run initialize_copper_session in headed mode to sign in.",
    );
  },
  notFound(what: string, details?: string): CopperToolError {
    return new CopperToolError("RECORD_NOT_FOUND", `${what} was not found.`, details);
  },
  selector(what: string, details?: string): CopperToolError {
    return new CopperToolError(
      "SELECTOR_FAILURE",
      `Could not locate "${what}" in the Copper UI.`,
      details ??
        "Both the primary and fallback selectors failed. The Copper UI may have changed; run capture_copper_diagnostics.",
    );
  },
  navigation(details?: string): CopperToolError {
    return new CopperToolError("NAVIGATION_FAILURE", "Failed to navigate the Copper UI.", details);
  },
  ambiguous(details?: string): CopperToolError {
    return new CopperToolError("AMBIGUOUS_RESULT", "The result was ambiguous.", details);
  },
  unexpectedUi(details?: string): CopperToolError {
    return new CopperToolError("UNEXPECTED_UI", "Encountered an unexpected Copper UI layout.", details);
  },
  browser(details?: string): CopperToolError {
    return new CopperToolError("BROWSER_FAILURE", "The browser could not complete the operation.", details);
  },
};
