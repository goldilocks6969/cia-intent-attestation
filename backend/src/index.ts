import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { log } from "./log.js";
import { registerRouter } from "./routes/register.js";
import { intentRouter } from "./routes/intent.js";
import { agentRouter } from "./routes/agent.js";
import { createCheckoutRouter } from "./routes/checkout.js";
import { auditRouter, devRouter } from "./routes/audit.js";
import { providerFromEnv } from "./payments.js";

const app = express();
app.disable("x-powered-by");
app.set("etag", false);
app.set("trust proxy", 1);
app.use(cors({ origin: config.expectedOrigin }));
app.use(express.json({ limit: "256kb" }));
app.use((req, _res, next) => {
  log("HTTP", `${req.method} ${req.path}`);
  next();
});


app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cia-backend", rpID: config.rpID, expectedOrigin: config.expectedOrigin });
});
app.use("/api/register", registerRouter);
app.use("/api/intent", intentRouter);
app.use("/api/agent", agentRouter);
app.use("/api/checkout", createCheckoutRouter(providerFromEnv()));
app.use("/api/audit", auditRouter);
app.use("/api/dev", devRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

// Global error handler — always structured JSON, never a stack trace to the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
  const status = e.status ?? e.statusCode ?? 500;
  const message = status >= 500 ? "internal error" : (e.message ?? "bad request");
  log("HTTP", `error ${status}: ${e.message ?? String(err)}`);
  res.status(status).json({ error: message, status, type: e.type ?? "error" });
});

app.listen(config.port, () => {
  log("BOOT", `cia-backend listening on http://localhost:${config.port}`, {
    rpID: config.rpID,
    expectedOrigin: config.expectedOrigin,
  });
});
