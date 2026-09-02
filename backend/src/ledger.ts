import canonicalize from "canonicalize";
import { sha256Hex } from "@cia/shared";

export interface GateCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface LedgerEntryBody {
  intentId: string;
  /** Hash of the agent's proposed transaction (canonical). */
  computedHash: string | null;
  /** The certificate hash it was compared against. */
  matchedCertHash: string | null;
  checks: GateCheck[];
  decision: "ALLOWED" | "BLOCKED";
  gate: "on" | "off";
  timestamp: number;
  orderId?: string | null;
  amountMinorUnits?: number | null;
}

export interface LedgerEntry {
  seq: number;
  prevHash: string;
  entry: LedgerEntryBody;
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

export function computeEntryHash(entry: LedgerEntryBody, prevHash: string): string {
  const canon = canonicalize(entry);
  if (canon === undefined) throw new Error("ledger entry not canonicalizable");
  return sha256Hex(canon + prevHash);
}

export interface VerifyChainResult {
  valid: boolean;
  length: number;
  brokenAt?: number;
  reason?: string;
}

/** Walk a chain and recompute every link. Pure: works on any array of entries. */
export function verifyChain(chain: LedgerEntry[]): VerifyChainResult {
  let prev = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i]!;
    if (e.seq !== i) return { valid: false, length: chain.length, brokenAt: i, reason: `seq ${e.seq} at index ${i}` };
    if (e.prevHash !== prev) return { valid: false, length: chain.length, brokenAt: i, reason: "prevHash does not link to previous entry" };
    const expected = computeEntryHash(e.entry, e.prevHash);
    if (e.hash !== expected) return { valid: false, length: chain.length, brokenAt: i, reason: "entry hash does not match its contents" };
    prev = e.hash;
  }
  return { valid: true, length: chain.length };
}

/** Append-only in-memory hash chain. */
export class Ledger {
  private chain: LedgerEntry[] = [];

  append(body: LedgerEntryBody): LedgerEntry {
    const prevHash = this.chain.length ? this.chain[this.chain.length - 1]!.hash : GENESIS_HASH;
    const entry: LedgerEntry = { seq: this.chain.length, prevHash, entry: body, hash: computeEntryHash(body, prevHash) };
    this.chain.push(entry);
    return entry;
  }

  all(): LedgerEntry[] {
    // Return the live objects so /dev/tamper can demonstrate detection; consumers must not mutate.
    return this.chain;
  }

  get length() {
    return this.chain.length;
  }

  head(): string {
    return this.chain.length ? this.chain[this.chain.length - 1]!.hash : GENESIS_HASH;
  }

  verify(): VerifyChainResult {
    return verifyChain(this.chain);
  }

  /** DEV ONLY: mutate an entry in place without recomputing its hash. */
  tamper(seq: number, mutate: (body: LedgerEntryBody) => void): LedgerEntry | undefined {
    const e = this.chain[seq];
    if (!e) return undefined;
    mutate(e.entry);
    return e;
  }

  reset() {
    this.chain = [];
  }
}

export const ledger = new Ledger();
