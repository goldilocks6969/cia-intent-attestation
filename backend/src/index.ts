import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { log } from "./log.js";
import { registerRouter } from "./routes/register.js";
import { intentRouter } from "./routes/intent.js";

const app = express();
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "internal error";
  log("HTTP", `unhandled error: ${message}`);
  res.status(500).json({ error: message });
});

app.listen(config.port, () => {
  log("BOOT", `cia-backend listening on http://localhost:${config.port}`, {
    rpID: config.rpID,
    expectedOrigin: config.expectedOrigin,
  });
});
