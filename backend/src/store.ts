import type { Intent, SignedIntentCertificate } from "@cia/shared";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import { log } from "./log.js";

export interface User {
  username: string;
  /** Stable WebAuthn user handle (random bytes). */
  userID: Uint8Array<ArrayBuffer>;
  credentials: WebAuthnCredential[];
}

export interface PendingIntent {
  intentId: string;
  userId: string;
  intent: Intent;
  hash: string;
  /** base64url(utf8(hash)) — what the authenticator actually signs over. */
  expectedChallenge: string;
  createdAt: number;
}

export type { SignedIntentCertificate };

/** In-memory stores. Fine for a demo; swap for a DB later. */
export const users = new Map<string, User>();
/** One-time registration challenges keyed by username. */
export const registrationChallenges = new Map<string, string>();
/** One-time intent challenges keyed by intentId. */
export const pendingIntents = new Map<string, PendingIntent>();
/** Issued certificates keyed by intentId. */
export const certificates = new Map<string, SignedIntentCertificate>();
/** Nonces that have been bound into a certificate (replay protection). */
export const usedNonces = new Set<string>();

export function findCredential(user: User, credentialID: string): WebAuthnCredential | undefined {
  return user.credentials.find((c) => c.id === credentialID);
}

/** Sweep pending intents older than their expiry so challenges don't live forever. */
export function sweepPending(now = Date.now()) {
  let removed = 0;
  for (const [id, p] of pendingIntents) {
    if (now >= p.intent.expiresAt) {
      pendingIntents.delete(id);
      removed++;
    }
  }
  if (removed) log("STORE", `swept ${removed} expired pending intent(s)`);
}
