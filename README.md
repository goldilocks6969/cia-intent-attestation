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

Add `?preview=certificate` to the URL to render a sample certificate without a passkey (handy for
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

Challenges (registration and intent) are single-use: they are deleted on the first verify attempt,
success or fail.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [SECURITY.md](./SECURITY.md).
