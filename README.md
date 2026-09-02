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

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [SECURITY.md](./SECURITY.md).
