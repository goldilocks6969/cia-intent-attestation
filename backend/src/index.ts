import express from "express";
import cors from "cors";
import { IntentSchema, hashIntent } from "@cia/shared";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cia-backend" });
});

// Sanity endpoint: returns the canonical hash of a submitted intent.
app.post("/intent/hash", (req, res) => {
  const parsed = IntentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  return res.json({ hash: hashIntent(parsed.data) });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`cia-backend listening on http://localhost:${port}`);
});
