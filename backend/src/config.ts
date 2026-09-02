const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  baseUrl: process.env.BASE_URL ?? "http://localhost:4000",
  rpName: "CIA — Cryptographic Intent Attestation",
  /** WebAuthn expected origin(s). */
  expectedOrigin: frontendOrigin,
  /** WebAuthn relying-party ID = hostname of the frontend origin. */
  rpID: new URL(frontendOrigin).hostname,
};
