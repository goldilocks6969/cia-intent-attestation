# CIA — Cryptographic Intent Attestation

Hackathon project: a user declares a purchase *intent* (merchant, category, max price, quantity, expiry),
the intent is canonicalized (RFC 8785) and hashed, and the hash is bound to a WebAuthn assertion.
A backend then verifies that any proposed transaction satisfies the attested constraints before payment.

## Layout

```
frontend/         React + Vite + TypeScript + Tailwind
backend/          Node.js + Express + TypeScript (@simplewebauthn/server, zod)
packages/shared/  Intent schema, canonicalization, hashing, constraint checker (@cia/shared)
```

## Getting started

```bash
npm install
cp .env.example .env
npm run dev            # runs backend + frontend concurrently
npm run dev:backend
npm run dev:frontend
npm test
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and the frontend build on every push.

Open http://localhost:5173. The frontend proxies `/api` to the backend on port 4000, so the WebAuthn
origin stays `http://localhost:5173` (RP ID `localhost`). Change `FRONTEND_ORIGIN` in `.env` if you
serve it elsewhere.

### Flow

1. **Register** — username → passkey created on the device (Touch ID / Windows Hello / security key).
2. **Intent** — merchant, category, max price in ₹ (converted to paise), quantity, validity window.
3. **Approve** — the server canonicalizes (RFC 8785) and hashes the intent; the hash *is* the WebAuthn
   challenge. The biometric prompt signs it.
4. **Certificate** — the Signed Intent Certificate `{ intent, hash, signature, authenticatorData,
   clientDataJSON, credentialID, status }` with a live expiry countdown and a re-verify button.

5. **Agent** — hand the certificate to a simulated shopping agent. "Run Agent (clean)" buys the
   intended item; "Run Agent (with attacker content)" serves a product page with a hidden prompt
   injection and the agent puts a ₹49,990 TV in the cart instead. The decision trace replays as a
   live log and the injected payload is flashed on screen. The 🛡️ Verification Gate toggle is
   remembered for the checkout step.

6. **Verdict** — checkout runs the verification gate: certificate present/unexpired/unconsumed,
   proposed-txn canonical hash, intent↔certificate hash binding, strict field comparison against
   the signed intent, constraint reasons, and an independent WebAuthn signature re-verification.
   ALLOWED creates a Razorpay test order (or a mock order if no keys are set). Flip the
   🛡️ gate OFF to see the unfenced path pay for the TV.
7. **Ledger** — every decision is appended to a tamper-evident hash chain
   (`hash = SHA256(canonicalize(entry) + prevHash)`). "Verify Ledger Integrity" walks the chain;
   "Tamper (dev)" mutates an entry in place so you can show detection live.

Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (test mode) to create real orders. Without them a
mock provider returns `order_mock_…` ids so the demo still completes offline.

Set `OPENAI_API_KEY` to run a real tool-using LLM agent (`OPENAI_MODEL`, default gpt-4o-mini).
Without a key the backend uses a deterministic scripted agent, so the demo works offline.
`AGENT_MODE=scripted|llm|auto` or `?agent=scripted` on the shop call forces a mode.

Add `?preview=certificate` (or `?preview=agent`) to the URL to render a sample certificate without a passkey (handy for
styling or rehearsing the demo).

### API (backend)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/register/begin` | registration options; challenge stored per user |
| POST | `/api/register/verify` | verify attestation, store `{ id, publicKey, counter }` |
| POST | `/api/intent` | validate → add nonce/timestamps → canonicalize + hash → auth options with challenge = hash |
| POST | `/api/intent/attest` | verify assertion (challenge/origin/rpID), self-check with `verifyCertificate`, persist certificate |
| GET | `/api/intent/certificate/:id` | fetch a certificate |
| POST | `/api/intent/certificate/:id/verify` | re-run the pure `verifyCertificate` against the stored public key |
| POST | `/api/intent/certificate/:id/check` | evaluate a proposed `{ merchant, priceMinorUnits, currency, quantity }` against the certificate's constraints |

| POST | `/api/agent/shop?attackEnabled=true\|false` | run the shopping agent for `{ intentId }`; returns `{ decision_trace, finalCart, hijacked, injectedPayload }` |
| GET | `/api/agent/product-page?sku=X&attackEnabled=true` | the attacker-controlled product page (HTML, or JSON with `format=json`) |
| GET | `/api/agent/run/:intentId` | latest agent run for an intent |

| POST | `/api/checkout?gate=on\|off` | the payment authorization gate for `{ intentId, cart? }` → `{ decision, checks[], razorpayOrder? }` (rate-limited) |
| GET | `/api/audit` | full hash-chained audit ledger |
| GET | `/api/audit/verify` | recompute every link → `{ valid, brokenAt?, reason? }` |
| POST | `/api/dev/tamper` | dev only: mutate a ledger entry in place to demo detection |

Challenges (registration and intent) are single-use: they are deleted on the first verify attempt,
success or fail.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [SECURITY.md](./SECURITY.md).
