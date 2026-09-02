# Security

## Threat model

**Assets.** The user's money, bounded by the intent's `maxPriceMinorUnits × quantity`; the
integrity of the audit ledger.

**Adversary.** Controls arbitrary merchant page content the agent reads as tool results, and may
run their own merchant. Can replay or replay-with-edits any certificate they observe. Cannot touch
the user's authenticator or the backend process.

**Goal.** Any transaction the gate allows is one whose every hard field the human signed, spent at
most once, within its validity window. Loss is bounded even when the agent is fully hijacked.

## What is bound to the signature

WebAuthn signs `authenticatorData ‖ SHA-256(clientDataJSON)`. That covers:

- **The intent hash** — it is the challenge, byte-for-byte (`base64url(utf8(hexHash))`).
- **The origin** — `clientDataJSON.origin`, checked against `FRONTEND_ORIGIN` on attest *and*
  again by `verifyCertificate` at checkout. A certificate minted on a phishing origin fails.
- **The RP ID** — `authenticatorData.rpIdHash = SHA-256(rpID)`, checked both times.
- **User presence and verification flags** — `UV` is required; a silent assertion is rejected.
- **The signature counter** — updated on every assertion (cloned-authenticator signal).

Because the intent hash is in the signed material and the canonical form whitelists fields, an
attacker cannot add, reorder, re-encode or re-price anything without changing the hash and thus
invalidating the signature.

## Replay protection

- **Registration and intent challenges are single-use.** They are deleted on the first verify
  attempt, success or failure. A failed attest requires a fresh intent.
- **Nonce.** Every intent carries a random UUID nonce that is part of the canonical form. Once a
  certificate is consumed its nonce is recorded; `verifyConstraints` rejects it thereafter.
- **Consume-before-pay.** The certificate is marked consumed *before* the payment provider is
  called, so two concurrent checkouts cannot both pass. If the provider fails, the certificate is
  released and the failure is ledgered.
- **Expiry.** `expiresAt` is in the signed intent; the gate checks it against server time.

## The gate is deterministic

`evaluateGate` is a pure function over the certificate, the cart, the stored public key and the set
of used nonces. It has no randomness, no model calls, and no reads from the merchant page. Checks
run in a fixed order and short-circuit; the full list of checks that ran is returned and ledgered
so a block is explainable.

## Ledger integrity

Each entry's hash is `SHA-256(canonicalize(entry) + prevHash)`. Editing any past entry, recomputing
one hash without its successors, or deleting an entry breaks verification at a specific `seq`.
The ledger is append-only in memory; a production deployment would anchor the head hash
externally (a signed timestamp, a public log) to defend against wholesale replacement.

## Hardening in this repo

- `helmet` security headers; CORS pinned to the frontend origin.
- Rate limiting: 20 checkouts / minute / IP, 300 API requests / minute / IP.
- `express.json` limited to 256 kB; zod validation on every body; structured JSON errors with no
  stack traces.
- `x-powered-by` disabled; ETags disabled on JSON responses.
- The LLM agent's system prompt does **not** warn about injection. That is deliberate: the demo
  shows a normal agent being hijacked and the gate catching it, not a hardened agent.

## Known limitations

- **In-memory state.** Users, credentials, certificates and the ledger vanish on restart.
- **Single RP origin.** `FRONTEND_ORIGIN` is one value; multi-origin deployments need a list.
- **Soft merchant matching.** `Amazon.in` ≡ `amazon` by design; an attacker-run "amazon-deals"
  storefront would pass the merchant check. The price cap, item match and quantity still hold.
- **Item matching is keyword-based.** `itemMatches` requires half the meaningful words of the
  description to appear in the cart item name. Empty descriptions impose no item constraint.
- **Compromised approver device** or a user tricked into signing a bad intent are out of scope.
- **Same-item exfiltration** (right item, right price, wrong seller inside the fuzzy match) is a
  bounded loss, not a prevented one.
- **`/api/dev/*`** endpoints are disabled when `NODE_ENV=production` but exist for the demo.
- **No persistence of the counter across restarts** weakens cloned-authenticator detection.

## Reporting

This is a hackathon project. Open an issue on the repository; do not include real credentials.
