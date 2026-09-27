// บันทึกหลักฐานการให้ความยินยอม (ไม่เก็บชื่อหรืออีเมล)
import { guard } from "./_gemini.js";
import { hasStore, pushRecord, validId, hash } from "./_store.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { device, version } = req.body || {};
  if (!validId(device)) return res.status(400).json({ error: "bad_id" });
  if (hasStore()) {
    try {
      await pushRecord("log:consents", { ts: new Date().toISOString(), user: hash(device), version: String(version || "").slice(0, 20) }, 20000);
    } catch (e) { console.error("store error", e); }
  }
  res.status(200).json({ ok: true });
}
