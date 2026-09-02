import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { Intent, SignedIntentCertificate, VerifyResult } from "@cia/shared/core";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    method: json !== undefined ? "POST" : "GET",
    ...rest,
    headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

// --- registration --------------------------------------------------------------------------

export interface RegisterVerifyResponse {
  verified: true;
  username: string;
  credentialID: string;
  credentialDeviceType: "singleDevice" | "multiDevice";
  credentialBackedUp: boolean;
}

export const api = {
  health: () => request<{ ok: boolean; rpID: string; expectedOrigin: string }>("/health"),

  registerBegin: (username: string) =>
    request<PublicKeyCredentialCreationOptionsJSON>("/register/begin", { json: { username } }),

  registerVerify: (username: string, response: RegistrationResponseJSON) =>
    request<RegisterVerifyResponse>("/register/verify", { json: { username, response } }),

  // --- intent ------------------------------------------------------------------------------

  createIntent: (input: IntentRequest) => request<CreateIntentResponse>("/intent", { json: input }),

  attestIntent: (intentId: string, response: AuthenticationResponseJSON) =>
    request<{ certificate: SignedIntentCertificate }>("/intent/attest", { json: { intentId, response } }),

  getCertificate: (intentId: string) =>
    request<{ certificate: SignedIntentCertificate }>(`/intent/certificate/${encodeURIComponent(intentId)}`),

  verifyCertificate: (intentId: string) =>
    request<CertificateVerification>(`/intent/certificate/${encodeURIComponent(intentId)}/verify`, { json: {} }),

  checkTransaction: (intentId: string, txn: { merchant: string; priceMinorUnits: number; currency?: string; quantity?: number }) =>
    request<VerifyResult & { status: SignedIntentCertificate["status"] }>(
      `/intent/certificate/${encodeURIComponent(intentId)}/check`,
      { json: txn },
    ),
};

export interface IntentRequest {
  userId: string;
  merchant: string;
  category: string;
  itemDescription: string;
  maxPriceMinorUnits: number;
  quantity: number;
  ttlMs?: number;
}

export interface CreateIntentResponse {
  intentId: string;
  intent: Intent;
  canonical: string;
  hash: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface CertificateVerification {
  valid: boolean;
  reasons: string[];
  details: {
    intentHash: string;
    challengeHex: string | null;
    origin: string | null;
    userPresent: boolean;
    userVerified: boolean;
    counter: number;
    signatureValid: boolean;
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err && typeof err === "object" && "name" in err) {
    const e = err as { name: string; message?: string };
    // @simplewebauthn/browser wraps DOMExceptions in WebAuthnError with a friendlier message.
    if (e.name === "NotAllowedError") return "The passkey prompt was cancelled or timed out. Try again.";
    if (e.name === "InvalidStateError") return "This authenticator is already registered for this user.";
    if (e.name === "SecurityError") return "WebAuthn security error — check the site origin matches the RP ID.";
    if (e.message) return e.message;
  }
  return String(err);
}
