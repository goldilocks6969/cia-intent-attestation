import { z } from "zod";
import canonicalize from "canonicalize";

/** Default intent lifetime: 10 minutes. */
export const DEFAULT_INTENT_TTL_MS = 10 * 60 * 1000;

export const IntentSchema = z.object({
  userId: z.string().min(1),
  merchant: z.string().min(1), // soft constraint
  category: z.string().min(1), // soft constraint
  itemDescription: z.string(), // informational
  maxPriceMinorUnits: z.number().int().nonnegative(), // paise — hard constraint
  currency: z.literal("INR"),
  quantity: z.number().int().positive(),
  nonce: z.string().min(1),
  issuedAt: z.number().int().nonnegative(), // epoch ms
  expiresAt: z.number().int().nonnegative(), // epoch ms
});

export type Intent = z.infer<typeof IntentSchema>;

/** The exact, ordered set of fields that participate in the canonical form. */
export const INTENT_FIELDS = [
  "userId",
  "merchant",
  "category",
  "itemDescription",
  "maxPriceMinorUnits",
  "currency",
  "quantity",
  "nonce",
  "issuedAt",
  "expiresAt",
] as const satisfies readonly (keyof Intent)[];

/** Build an intent with sensible defaults for nonce / issuedAt / expiresAt. */
export function createIntent(
  input: Omit<Intent, "nonce" | "issuedAt" | "expiresAt" | "currency"> &
    Partial<Pick<Intent, "nonce" | "issuedAt" | "expiresAt" | "currency">>,
): Intent {
  const issuedAt = input.issuedAt ?? Date.now();
  return IntentSchema.parse({
    ...input,
    currency: input.currency ?? "INR",
    nonce: input.nonce ?? globalThis.crypto.randomUUID(),
    issuedAt,
    expiresAt: input.expiresAt ?? issuedAt + DEFAULT_INTENT_TTL_MS,
  });
}

/** Normalize a string: trim + NFC unicode normalization. */
export function normalizeString(s: unknown): string {
  if (typeof s !== "string") throw new TypeError(`expected string, got ${typeof s}`);
  return s.normalize("NFC").trim();
}

/**
 * Normalize a price to integer minor units (paise).
 * Rejects non-finite values and non-integers: ₹1,999.90 must be passed as 199990.
 */
export function normalizeMinorUnits(v: unknown): number {
  const n = typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new TypeError(`price must be a finite number of minor units, got ${String(v)}`);
  }
  if (!Number.isInteger(n)) {
    throw new TypeError(`price must be an integer number of minor units, got ${n}`);
  }
  if (n < 0) throw new RangeError(`price must be non-negative, got ${n}`);
  return n;
}

function normalizeInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new TypeError(`${name} must be a finite integer, got ${String(v)}`);
  }
  return v;
}

/**
 * Produce the normalized, field-selected intent object.
 * Unknown/extra fields are dropped; every kept field is normalized.
 */
export function normalizeIntent(input: Record<string, unknown>): Intent {
  const out: Intent = {
    userId: normalizeString(input.userId),
    merchant: normalizeString(input.merchant),
    category: normalizeString(input.category),
    itemDescription: normalizeString(input.itemDescription),
    maxPriceMinorUnits: normalizeMinorUnits(input.maxPriceMinorUnits),
    currency: "INR",
    quantity: normalizeInt(input.quantity, "quantity"),
    nonce: normalizeString(input.nonce),
    issuedAt: normalizeInt(input.issuedAt, "issuedAt"),
    expiresAt: normalizeInt(input.expiresAt, "expiresAt"),
  };
  if (normalizeString(input.currency) !== "INR") {
    throw new TypeError(`currency must be "INR", got ${String(input.currency)}`);
  }
  return IntentSchema.parse(out);
}

/**
 * RFC 8785 (JCS) canonical serialization of an intent.
 * Only the whitelisted fields are included; keys are sorted; numbers are ES6-serialized.
 */
export function canonicalIntent(input: Record<string, unknown>): string {
  const normalized = normalizeIntent(input);
  const selected: Record<string, unknown> = {};
  for (const k of INTENT_FIELDS) selected[k] = normalized[k];
  const out = canonicalize(selected);
  if (out === undefined) throw new Error("canonicalization failed");
  return out;
}

// ---------------------------------------------------------------------------
// Constraint verification
// ---------------------------------------------------------------------------

export interface ProposedTxn {
  merchant: string;
  /** Unit price in minor units (paise). */
  priceMinorUnits: number;
  currency: string;
  quantity?: number;
  category?: string;
}

export interface VerifyOptions {
  /** Nonces already consumed. Presence of intent.nonce here fails the hard check. */
  usedNonces?: Pick<Set<string>, "has"> | ((nonce: string) => boolean);
  /** Override "now" (epoch ms) for deterministic tests. */
  now?: number;
}

export interface VerifyResult {
  hardPass: boolean;
  softMatch: boolean;
  reasons: string[];
}

/**
 * Normalize a merchant name for fuzzy comparison:
 * lowercase, strip "www.", TLD suffixes (.in, .com, ...), spaces and punctuation.
 */
export function normalizeMerchant(s: string): string {
  let m = normalizeString(s).toLowerCase();
  m = m.replace(/^https?:\/\//, "");
  m = m.replace(/^www\./, "");
  m = m.replace(/\/.*$/, ""); // drop any path
  m = m.replace(/(\.(co\.in|in|com|net|org|io|co))+$/, "");
  m = m.replace(/[^\p{L}\p{N}]+/gu, "");
  return m;
}

export function merchantsMatch(a: string, b: string): boolean {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export function verifyConstraints(
  intentInput: Intent,
  proposed: ProposedTxn,
  opts: VerifyOptions = {},
): VerifyResult {
  const intent = IntentSchema.parse(intentInput);
  const reasons: string[] = [];
  const now = opts.now ?? Date.now();
  const qty = proposed.quantity ?? intent.quantity;

  let hardPass = true;

  // --- hard: total price within cap
  let total: number | undefined;
  try {
    const unit = normalizeMinorUnits(proposed.priceMinorUnits);
    const q = normalizeInt(qty, "quantity");
    if (q <= 0) throw new RangeError("quantity must be positive");
    total = unit * q;
    if (!Number.isSafeInteger(total)) throw new RangeError("total overflows safe integer range");
    if (total > intent.maxPriceMinorUnits) {
      hardPass = false;
      reasons.push(`price ${total} exceeds max ${intent.maxPriceMinorUnits} (unit ${unit} × qty ${q})`);
    }
  } catch (e) {
    hardPass = false;
    reasons.push(`invalid proposed price/quantity: ${(e as Error).message}`);
  }

  // --- hard: currency
  if (normalizeString(proposed.currency).toUpperCase() !== intent.currency) {
    hardPass = false;
    reasons.push(`currency mismatch: expected ${intent.currency}, got ${proposed.currency}`);
  }

  // --- hard: expiry
  if (now >= intent.expiresAt) {
    hardPass = false;
    reasons.push(`intent expired at ${new Date(intent.expiresAt).toISOString()}`);
  }
  if (intent.issuedAt > intent.expiresAt) {
    hardPass = false;
    reasons.push("intent issuedAt is after expiresAt");
  }

  // --- hard: nonce unused
  const used =
    typeof opts.usedNonces === "function"
      ? opts.usedNonces(intent.nonce)
      : opts.usedNonces?.has(intent.nonce) ?? false;
  if (used) {
    hardPass = false;
    reasons.push(`nonce ${intent.nonce} has already been used`);
  }

  // --- soft: merchant fuzzy match
  const softMatch = merchantsMatch(intent.merchant, proposed.merchant);
  if (!softMatch) {
    reasons.push(`merchant mismatch (soft): intent "${intent.merchant}" vs proposed "${proposed.merchant}"`);
  }

  return { hardPass, softMatch, reasons };
}

// ---------------------------------------------------------------------------
// Signed Intent Certificate (shared shape between backend + frontend)
// ---------------------------------------------------------------------------

export type CertificateStatus = "active" | "consumed" | "expired" | "revoked";

export interface SignedIntentCertificate {
  intentId: string;
  intent: Intent;
  /** SHA-256 hex of the RFC 8785 canonical intent. */
  hash: string;
  signature: string; // base64url
  authenticatorData: string; // base64url
  clientDataJSON: string; // base64url
  credentialID: string; // base64url
  rpID: string;
  origin: string;
  issuedAt: number;
  status: CertificateStatus;
  consumedAt: number | null;
}
