import { hashIntent, hashTxn, intentAsTxn, itemMatches, merchantsMatch, verifyConstraints, type SignedIntentCertificate } from "@cia/shared";
import { verifyCertificate } from "./certificate.js";
import type { GateCheck } from "./ledger.js";
import type { CartLine } from "./agent/tools.js";

export interface GateInput {
  cert: SignedIntentCertificate | undefined;
  cart: CartLine | null | undefined;
  /** COSE public key of the credential that signed the certificate (undefined → signature check fails). */
  publicKey: Uint8Array | undefined;
  /** Nonces consumed by *other* certificates. */
  usedNonces: Set<string>;
  now?: number;
  rpID: string;
  origin: string;
}

export interface GateResult {
  decision: "ALLOWED" | "BLOCKED";
  checks: GateCheck[];
  computedHash: string | null;
  matchedCertHash: string | null;
  amountMinorUnits: number | null;
}

/**
 * The verification gate. Pure: no store access, no side effects. Checks run in order and
 * short-circuit on the first failure, but every check that ran is returned for the audit trail.
 */
export async function evaluateGate(input: GateInput): Promise<GateResult> {
  const { cert, cart, publicKey, usedNonces, rpID, origin } = input;
  const now = input.now ?? Date.now();
  const checks: GateCheck[] = [];
  let computedHash: string | null = null;
  const matchedCertHash = cert?.hash ?? null;
  const amount = cart ? cart.priceMinorUnits * cart.quantity : null;

  const fail = (): GateResult => ({ decision: "BLOCKED", checks, computedHash, matchedCertHash, amountMinorUnits: amount });
  const push = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, passed, detail });
    return passed;
  };

  // 1. certificate exists + not expired
  if (!push("certificate_present", Boolean(cert), cert ? `certificate ${cert.intentId} loaded` : "no certificate for this intentId")) return fail();
  const c = cert!;
  const msLeft = c.intent.expiresAt - now;
  if (!push("certificate_unexpired", msLeft > 0 && c.status !== "expired" && c.status !== "revoked", msLeft > 0 ? `valid for ${Math.ceil(msLeft / 1000)}s more` : `expired ${Math.ceil(-msLeft / 1000)}s ago`)) return fail();

  // 2. one-time use
  if (!push("certificate_unconsumed", c.consumedAt === null && c.status === "active", c.consumedAt === null ? "never consumed" : `already consumed at ${new Date(c.consumedAt).toISOString()}`)) return fail();

  // 3. proposed transaction present + canonical hash
  if (!push("cart_present", Boolean(cart), cart ? `${cart.quantity}× ${cart.name} (${cart.sku}) @ ${cart.priceMinorUnits} paise` : "agent produced no cart")) return fail();
  const k = cart!;
  const txn = {
    merchant: k.merchant,
    category: c.intent.category,
    itemDescription: k.name,
    priceMinorUnits: k.priceMinorUnits * k.quantity,
    currency: k.currency,
    quantity: k.quantity,
  };
  try {
    computedHash = hashTxn(txn);
  } catch (e) {
    push("txn_canonicalization", false, `proposed txn not canonicalizable: ${(e as Error).message}`);
    return fail();
  }
  push("txn_canonicalization", true, `sha256(canonical txn) = ${computedHash}`);

  // 4a. certificate hash binding — the intent inside the cert must still hash to cert.hash
  let intentHash: string;
  try {
    intentHash = hashIntent(c.intent);
  } catch (e) {
    push("intent_hash_binding", false, `certificate intent not canonicalizable: ${(e as Error).message}`);
    return fail();
  }
  if (!push("intent_hash_binding", intentHash === c.hash, intentHash === c.hash ? `sha256(canonical intent) = ${c.hash}` : `intent re-hashes to ${intentHash}, certificate says ${c.hash} — certificate tampered`)) return fail();

  // 4b. strict field comparison: proposed txn projected against the signed intent
  const want = intentAsTxn(c.intent);
  const mismatches: string[] = [];
  if (txn.currency.toUpperCase() !== want.currency) mismatches.push(`currency ${txn.currency} ≠ ${want.currency}`);
  if (txn.quantity !== want.quantity) mismatches.push(`quantity ${txn.quantity} ≠ ${want.quantity}`);
  if (txn.priceMinorUnits > want.priceMinorUnits) mismatches.push(`total ${txn.priceMinorUnits} > cap ${want.priceMinorUnits}`);
  if (!merchantsMatch(k.merchant, c.intent.merchant)) mismatches.push(`merchant "${k.merchant}" ≠ "${c.intent.merchant}"`);
  if (!itemMatches(c.intent.itemDescription, k.name)) mismatches.push(`item "${k.name}" does not match approved "${c.intent.itemDescription}"`);
  const exact = computedHash === c.hash;
  if (!push("hash_match", mismatches.length === 0, mismatches.length === 0 ? (exact ? "exact hash match" : `txn ${computedHash.slice(0, 12)}… ⊆ intent ${c.hash.slice(0, 12)}… (total ${txn.priceMinorUnits} ≤ cap ${want.priceMinorUnits}, all hard fields equal)`) : mismatches.join("; "))) return fail();

  // 4c. nuanced constraint reasons (expiry, nonce reuse, price × qty)
  const vc = verifyConstraints(c.intent, { merchant: k.merchant, priceMinorUnits: k.priceMinorUnits, currency: k.currency, quantity: k.quantity }, { usedNonces, now });
  if (!push("constraints", vc.hardPass, vc.hardPass ? `hard constraints pass${vc.softMatch ? "" : " (soft merchant mismatch: " + vc.reasons.join("; ") + ")"}` : vc.reasons.join("; "))) return fail();

  // 5. independent WebAuthn signature re-verification
  if (!publicKey) {
    push("signature", false, "signing credential not found");
    return fail();
  }
  const sig = await verifyCertificate(c, c.hash, publicKey, { rpID, origin });
  if (!push("signature", sig.valid, sig.valid ? `WebAuthn assertion verifies · UV=${sig.details.userVerified ? 1 : 0} · challenge=${sig.details.challengeHex?.slice(0, 12)}…` : sig.reasons.join("; "))) return fail();

  return { decision: "ALLOWED", checks, computedHash, matchedCertHash, amountMinorUnits: amount };
}
