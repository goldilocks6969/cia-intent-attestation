import { createHash } from "node:crypto";
import { canonicalIntent } from "./core.js";

/** SHA-256 hex digest of the RFC 8785 canonical intent. */
export function hashIntent(intent: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalIntent(intent), "utf8").digest("hex");
}
