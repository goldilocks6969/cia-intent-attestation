import { sha256Bytes, toBytes } from "./bytes.js";
import { hashIntent, type Intent } from "@cia/shared";
import {
  decodeClientDataJSON,
  isoBase64URL,
  isoUint8Array,
  parseAuthenticatorData,
  verifySignature,
} from "@simplewebauthn/server/helpers";

/** Minimal shape needed to verify a certificate; the stored one is a superset. */
export interface VerifiableCertificate {
  intent: Intent;
  hash: string;
  signature: string; // base64url
  authenticatorData: string; // base64url
  clientDataJSON: string; // base64url
}

export interface VerifyCertificateOptions {
  /** If set, the rpIdHash in authenticatorData must equal SHA-256(rpID). */
  rpID?: string;
  /** If set, clientDataJSON.origin must match one of these. */
  origin?: string | string[];
  /** Require the UV (user-verified) flag, i.e. biometric/PIN actually happened. Default true. */
  requireUserVerification?: boolean;
}

export interface VerifyCertificateResult {
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

/** The challenge encoding used everywhere: base64url(utf8(hexHash)). */
export function challengeForHash(hexHash: string): string {
  return isoBase64URL.fromUTF8String(hexHash);
}

/**
 * Pure verification of a Signed Intent Certificate. No store access, no side effects.
 *
 * Checks, in order:
 *  1. cert.hash equals expectedHash AND re-hashing cert.intent reproduces it
 *  2. clientDataJSON is a `webauthn.get` whose challenge encodes expectedHash (and origin, if given)
 *  3. authenticatorData rpIdHash matches rpID (if given) and UP/UV flags are set
 *  4. signature over authenticatorData || SHA-256(clientDataJSON) verifies with publicKeyBytes (COSE)
 */
export async function verifyCertificate(
  cert: VerifiableCertificate,
  expectedHash: string,
  publicKeyBytes: Uint8Array,
  opts: VerifyCertificateOptions = {},
): Promise<VerifyCertificateResult> {
  const reasons: string[] = [];
  const details: VerifyCertificateResult["details"] = {
    intentHash: "",
    challengeHex: null,
    origin: null,
    userPresent: false,
    userVerified: false,
    counter: 0,
    signatureValid: false,
  };

  // 1. hash binding
  let intentHash = "";
  try {
    intentHash = hashIntent(cert.intent);
  } catch (e) {
    reasons.push(`intent is not canonicalizable: ${(e as Error).message}`);
  }
  details.intentHash = intentHash;
  if (cert.hash !== expectedHash) reasons.push("certificate hash does not equal expected hash");
  if (intentHash && intentHash !== expectedHash) reasons.push("re-hashed intent does not equal expected hash");

  // 2. clientDataJSON
  let clientDataBytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    clientDataBytes = isoBase64URL.toBuffer(cert.clientDataJSON);
    const cd = decodeClientDataJSON(cert.clientDataJSON);
    details.origin = cd.origin;
    if (cd.type !== "webauthn.get") reasons.push(`clientData type is ${cd.type}, expected webauthn.get`);
    if (cd.challenge !== challengeForHash(expectedHash)) {
      reasons.push("clientData challenge does not encode the expected hash");
    }
    try {
      details.challengeHex = isoUint8Array.toUTF8String(isoBase64URL.toBuffer(cd.challenge));
    } catch {
      details.challengeHex = null;
    }
    if (opts.origin) {
      const allowed = Array.isArray(opts.origin) ? opts.origin : [opts.origin];
      if (!allowed.includes(cd.origin)) reasons.push(`origin ${cd.origin} not in allowed origins`);
    }
  } catch (e) {
    reasons.push(`clientDataJSON undecodable: ${(e as Error).message}`);
  }

  // 3. authenticatorData
  let authDataBytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    authDataBytes = isoBase64URL.toBuffer(cert.authenticatorData);
    const ad = parseAuthenticatorData(authDataBytes);
    details.userPresent = ad.flags.up;
    details.userVerified = ad.flags.uv;
    details.counter = ad.counter;
    if (!ad.flags.up) reasons.push("user-present flag not set");
    if ((opts.requireUserVerification ?? true) && !ad.flags.uv) reasons.push("user-verified flag not set");
    if (opts.rpID) {
      const expectedRpIdHash = sha256Bytes(opts.rpID);
      if (!isoUint8Array.areEqual(ad.rpIdHash, expectedRpIdHash)) reasons.push("rpIdHash does not match rpID");
    }
  } catch (e) {
    reasons.push(`authenticatorData undecodable: ${(e as Error).message}`);
  }

  // 4. signature
  if (clientDataBytes && authDataBytes) {
    try {
      const clientDataHash = sha256Bytes(clientDataBytes);
      const data = isoUint8Array.concat([authDataBytes, clientDataHash]);
      const signature = isoBase64URL.toBuffer(cert.signature);
      details.signatureValid = await verifySignature({ signature, data, credentialPublicKey: toBytes(publicKeyBytes) });
      if (!details.signatureValid) reasons.push("signature does not verify against public key");
    } catch (e) {
      reasons.push(`signature verification error: ${(e as Error).message}`);
    }
  }

  return { valid: reasons.length === 0, reasons, details };
}
