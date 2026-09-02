import { createHash } from "node:crypto";
import { canonicalIntent } from "./core.js";

/** SHA-256 hex digest of the RFC 8785 canonical intent. */
export function hashIntent(intent: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalIntent(intent), "utf8").digest("hex");
}

import { canonicalTxn } from "./core.js";

/** SHA-256 hex digest of the RFC 8785 canonical proposed transaction. */
export function hashTxn(txn: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalTxn(txn), "utf8").digest("hex");
}

/** Generic SHA-256 hex of a UTF-8 string (used by the audit ledger). */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
