/**
 * Canonical MCP response envelopes. Every tool returns structured JSON (never raw
 * HTML) wrapped in a single text content block so it renders cleanly in Claude.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  CopperToolError,
  isCopperToolError,
  type CopperErrorCode,
} from "../types/errors.js";

export interface SuccessMeta {
  source: string;
  recordCount?: number;
  [k: string]: unknown;
}

export interface SuccessEnvelope<T> {
  success: true;
  message: string;
  data: T;
  meta: SuccessMeta;
}

export interface ErrorEnvelope {
  success: false;
  message: string;
  error: {
    code: CopperErrorCode;
    details?: string;
    artifactPath?: string;
  };
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

const DEFAULT_SOURCE = "copper-web-ui";

/** Build a success envelope. */
export function ok<T>(
  message: string,
  data: T,
  meta: Partial<SuccessMeta> = {},
): SuccessEnvelope<T> {
  return {
    success: true,
    message,
    data,
    meta: { source: DEFAULT_SOURCE, ...meta },
  };
}

/** Build an error envelope. */
export function fail(
  code: CopperErrorCode,
  message: string,
  details?: string,
  artifactPath?: string,
): ErrorEnvelope {
  return {
    success: false,
    message,
    error: { code, details, artifactPath },
  };
}

/** Serialize any envelope into an MCP CallToolResult. */
export function toCallToolResult(envelope: Envelope<unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError: envelope.success === false,
  };
}

/** Convenience: success envelope → CallToolResult. */
export function okResult<T>(
  message: string,
  data: T,
  meta: Partial<SuccessMeta> = {},
): CallToolResult {
  return toCallToolResult(ok(message, data, meta));
}

/**
 * Turn any thrown value into a structured error CallToolResult. Zod validation
 * errors become VALIDATION_FAILURE; CopperToolError keeps its own code (and
 * artifact path); anything else becomes UNKNOWN.
 */
export function errorToResult(err: unknown): CallToolResult {
  if (err instanceof z.ZodError) {
    return toCallToolResult(
      fail(
        "VALIDATION_FAILURE",
        "Input validation failed.",
        err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      ),
    );
  }
  if (isCopperToolError(err)) {
    return toCallToolResult(
      fail(err.code, err.message, err.details, err.artifactPath),
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return toCallToolResult(fail("UNKNOWN", "Unexpected error.", message));
}

export { CopperToolError };
