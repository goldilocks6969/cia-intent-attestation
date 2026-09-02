import { Router } from "express";
import { z } from "zod";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { generateUserID } from "@simplewebauthn/server/helpers";
import { toBytes } from "../bytes.js";
import { config } from "../config.js";
import { log, logError } from "../log.js";
import { registrationChallenges, users } from "../store.js";

export const registerRouter = Router();

const BeginSchema = z.object({ username: z.string().trim().min(1).max(64) });

registerRouter.post("/begin", async (req, res) => {
  const parsed = BeginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "username required" });
  const { username } = parsed.data;

  let user = users.get(username);
  if (!user) {
    user = { username, userID: await generateUserID(), credentials: [] };
    users.set(username, user);
    log("REGISTER", "created user", { username });
  }

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: username,
    userID: user.userID,
    attestationType: "none",
    excludeCredentials: user.credentials.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required", // we want the biometric / PIN
      authenticatorAttachment: "platform",
    },
  });

  registrationChallenges.set(username, options.challenge);
  log("REGISTER", "issued registration challenge", { username, rpID: config.rpID });
  return res.json(options);
});

const VerifySchema = z.object({ username: z.string().trim().min(1), response: z.any() });

registerRouter.post("/verify", async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "username and response required" });
  const { username, response } = parsed.data;

  const user = users.get(username);
  const expectedChallenge = registrationChallenges.get(username);
  registrationChallenges.delete(username); // one-time use, success or fail
  if (!user || !expectedChallenge) {
    log("REGISTER", "no pending challenge", { username });
    return res.status(400).json({ error: "no pending registration for this user — call /begin first" });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified) {
      log("REGISTER", "verification failed", { username });
      return res.status(400).json({ error: "registration could not be verified" });
    }
    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
    // Replace if the same credential id was somehow re-registered.
    user.credentials = user.credentials.filter((c) => c.id !== credential.id);
    user.credentials.push({
      id: credential.id,
      publicKey: toBytes(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
    });
    log("REGISTER", "✓ credential stored", {
      username,
      credentialID: credential.id,
      publicKeyBytes: credential.publicKey.byteLength,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      aaguid,
    });
    return res.json({
      verified: true,
      username,
      credentialID: credential.id,
      credentialDeviceType,
      credentialBackedUp,
    });
  } catch (err) {
    logError("REGISTER", "verifyRegistrationResponse threw", err);
    return res.status(400).json({ error: (err as Error).message });
  }
});
