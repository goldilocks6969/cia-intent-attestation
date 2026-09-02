import { describe, it, expect } from "vitest";
import { Ledger, GENESIS_HASH, verifyChain, computeEntryHash, type LedgerEntryBody } from "./ledger.js";

function body(i: number, decision: "ALLOWED" | "BLOCKED" = "ALLOWED"): LedgerEntryBody {
  return {
    intentId: `intent-${i}`,
    computedHash: "a".repeat(64),
    matchedCertHash: "b".repeat(64),
    checks: [{ name: "hash_match", passed: decision === "ALLOWED", detail: "x" }],
    decision,
    gate: "on",
    timestamp: 1_800_000_000_000 + i,
    orderId: decision === "ALLOWED" ? `order_${i}` : null,
    amountMinorUnits: 100 * i,
  };
}

describe("hash-chained audit ledger", () => {
  it("links every entry to the previous hash and verifies", () => {
    const l = new Ledger();
    const a = l.append(body(0));
    const b = l.append(body(1, "BLOCKED"));
    const c = l.append(body(2));
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(a.hash).toBe(computeEntryHash(body(0), GENESIS_HASH));
    expect(l.verify()).toEqual({ valid: true, length: 3 });
    expect(l.head()).toBe(c.hash);
  });

  it("hash is deterministic and key-order independent (RFC 8785)", () => {
    const x = body(5);
    const shuffled = Object.fromEntries(Object.entries(x).reverse()) as LedgerEntryBody;
    expect(computeEntryHash(shuffled, GENESIS_HASH)).toBe(computeEntryHash(x, GENESIS_HASH));
    expect(computeEntryHash(x, "1".repeat(64))).not.toBe(computeEntryHash(x, GENESIS_HASH));
  });

  it("detects a mutated entry and reports where the chain broke", () => {
    const l = new Ledger();
    for (let i = 0; i < 5; i++) l.append(body(i, i % 2 ? "BLOCKED" : "ALLOWED"));
    l.tamper(2, (e) => {
      e.decision = "ALLOWED";
      e.amountMinorUnits = 1;
    });
    const r = l.verify();
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toMatch(/hash does not match/);
  });

  it("detects a re-hashed entry (attacker recomputes the hash but not the successors)", () => {
    const l = new Ledger();
    for (let i = 0; i < 4; i++) l.append(body(i));
    const chain = l.all().map((e) => ({ ...e, entry: { ...e.entry } }));
    chain[1]!.entry.decision = "BLOCKED";
    chain[1]!.hash = computeEntryHash(chain[1]!.entry, chain[1]!.prevHash);
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toMatch(/prevHash/);
  });

  it("detects a deleted entry", () => {
    const l = new Ledger();
    for (let i = 0; i < 3; i++) l.append(body(i));
    const chain = l.all().filter((e) => e.seq !== 1);
    expect(verifyChain(chain)).toMatchObject({ valid: false, brokenAt: 1 });
    expect(verifyChain([])).toEqual({ valid: true, length: 0 });
  });
});
