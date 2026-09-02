import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { hashIntent, type Intent, type SignedIntentCertificate } from "@cia/shared";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { challengeForHash } from "../certificate.js";
import { toBytes } from "../bytes.js";

/** Fabricate a WebAuthn-shaped Signed Intent Certificate using a software P-256 key. */
export function makeFakeCert(
  intent: Intent,
  opts: { rpID?: string; origin?: string; flags?: number; challenge?: string; intentId?: string } = {},
): { cert: SignedIntentCertificate; hash: string; cose: Uint8Array<ArrayBuffer> } {
  const rpID = opts.rpID ?? "localhost";
  const origin = opts.origin ?? "http://localhost:5173";
  const hash = hashIntent(intent);
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = toBytes(Buffer.from(jwk.x as string, "base64url"));
  const y = toBytes(Buffer.from(jwk.y as string, "base64url"));
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array<ArrayBuffer>>([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]) as never);

  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: opts.challenge ?? challengeForHash(hash), origin, crossOrigin: false }));
  const ad = Buffer.alloc(37);
  createHash("sha256").update(rpID).digest().copy(ad, 0);
  ad[32] = opts.flags ?? 0b0000_0101; // UP | UV
  ad.writeUInt32BE(1, 33);
  const clientDataHash = createHash("sha256").update(clientData).digest();
  const signer = createSign("SHA256");
  signer.update(Buffer.concat([ad, clientDataHash]));
  const signature = signer.sign({ key: privateKey, dsaEncoding: "der" });

  const cert: SignedIntentCertificate = {
    intentId: opts.intentId ?? "11111111-1111-4111-8111-111111111111",
    intent,
    hash,
    signature: isoBase64URL.fromBuffer(toBytes(signature)),
    authenticatorData: isoBase64URL.fromBuffer(toBytes(ad)),
    clientDataJSON: isoBase64URL.fromBuffer(toBytes(clientData)),
    credentialID: "fake-cred",
    rpID,
    origin,
    issuedAt: intent.issuedAt,
    status: "active",
    consumedAt: null,
  };
  return { cert, hash, cose: toBytes(cose) };
}
