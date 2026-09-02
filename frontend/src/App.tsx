import { canonicalIntent, type Intent } from "@cia/shared/core";

const demo: Intent = {
  userId: "demo-user",
  merchant: "Amazon.in",
  category: "electronics",
  itemDescription: "USB-C cable",
  maxPriceMinorUnits: 199990,
  currency: "INR",
  quantity: 1,
  nonce: crypto.randomUUID(),
  issuedAt: Date.now(),
  expiresAt: Date.now() + 10 * 60 * 1000,
};

export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-3xl font-bold">CIA — Cryptographic Intent Attestation</h1>
      <p className="mt-2 text-slate-400">Canonical intent (RFC 8785):</p>
      <pre className="mt-4 rounded bg-slate-900 p-4 text-sm overflow-x-auto">{canonicalIntent(demo)}</pre>
    </main>
  );
}
