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

// --- agent -----------------------------------------------------------------------------------

export type TraceRole = "agent" | "tool" | "attacker" | "system";
export type TraceType = "thought" | "tool_call" | "result" | "warning" | "decision" | "info";

export interface TraceEntry {
  step: number;
  ts: number;
  role: TraceRole;
  type: TraceType;
  color: "green" | "cyan" | "amber" | "red" | "slate";
  text: string;
  thought?: string;
  action?: { tool: string; args: Record<string, unknown> };
  data?: unknown;
}

export interface CartLine {
  sku: string;
  name: string;
  merchant: string;
  priceMinorUnits: number;
  currency: "INR";
  quantity: number;
}

export interface AgentRun {
  runId: string;
  intentId: string;
  mode: "scripted" | "llm";
  attackEnabled: boolean;
  startedAt: number;
  finishedAt: number;
  decision_trace: TraceEntry[];
  finalCart: CartLine | null;
  hijacked: boolean;
  intendedSku: string | null;
  injectedPayload: string | null;
}

export const agentApi = {
  shop: (intentId: string, attackEnabled: boolean) =>
    request<AgentRun>(`/agent/shop?attackEnabled=${attackEnabled ? "true" : "false"}`, { json: { intentId } }),
  latestRun: (intentId: string) => request<AgentRun>(`/agent/run/${encodeURIComponent(intentId)}`),
};

// --- checkout + audit --------------------------------------------------------------------------

export interface GateCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
  mock: boolean;
}

export interface CheckoutResponse {
  decision: "ALLOWED" | "BLOCKED";
  gate: "on" | "off";
  checks: GateCheck[];
  reason?: string;
  razorpayOrder?: RazorpayOrder;
  cart: CartLine | null;
  intent?: Intent | null;
  certificateHash?: string;
  ledger: { seq: number; hash: string };
}

/** A checkout result as remembered by the UI (adds client timestamp + intent id). */
export interface StoredResult extends CheckoutResponse {
  intentId: string;
  at: number;
}

export interface LedgerEntry {
  seq: number;
  prevHash: string;
  hash: string;
  entry: {
    intentId: string;
    computedHash: string | null;
    matchedCertHash: string | null;
    checks: GateCheck[];
    decision: "ALLOWED" | "BLOCKED";
    gate: "on" | "off";
    timestamp: number;
    orderId?: string | null;
    amountMinorUnits?: number | null;
  };
}

export interface LedgerVerify {
  valid: boolean;
  length: number;
  brokenAt?: number;
  reason?: string;
}

export const checkoutApi = {
  /** BLOCKED comes back as HTTP 403 with a full body; unwrap it instead of throwing. */
  checkout: async (intentId: string, gateEnabled: boolean, cart?: CartLine): Promise<CheckoutResponse> => {
    try {
      return await request<CheckoutResponse>(`/checkout?gate=${gateEnabled ? "on" : "off"}`, { json: { intentId, cart } });
    } catch (e) {
      if (e instanceof ApiError && e.body && typeof e.body === "object" && "decision" in e.body) return e.body as CheckoutResponse;
      throw e;
    }
  },
  audit: () => request<{ length: number; head: string; chain: LedgerEntry[] }>("/audit"),
  verify: () => request<LedgerVerify>("/audit/verify"),
  tamper: (seq?: number) => request<{ tampered: number }>("/dev/tamper", { json: { seq, field: "decision" } }),
};
