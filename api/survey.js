// รับแบบสอบถามหลังประเมินการฝึก
import { guard } from "./_gemini.js";
import { hasStore, pushRecord, validId, hash } from "./_store.js";

const pick = (v, allowed) => (allowed.includes(v) ? v : "");

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (!hasStore()) return res.status(503).json({ error: "no_store" });
  const b = req.body || {};
  if (!validId(b.device) || !validId(b.session)) return res.status(400).json({ error: "bad_id" });
  const rating = Math.max(0, Math.min(5, parseInt(b.rating, 10) || 0));
  if (!rating) return res.status(400).json({ error: "need_rating" });

  const record = {
    ts: new Date().toISOString(),
    session: b.session,
    user: hash(b.device),
    caseId: String(b.caseId || "").slice(0, 20),
    rating,
    realistic: Math.max(0, Math.min(5, parseInt(b.realistic, 10) || 0)),
    useAgain: pick(b.useAgain, ["แน่นอน", "อาจจะ", "ไม่"]),
    pay: pick(b.pay, ["ไม่จ่าย", "ไม่เกิน 99", "100–199", "200–399", "400 ขึ้นไป"]),
    role: pick(b.role, ["นักศึกษาปริญญาตรี", "นักศึกษาปริญญาโท/เอก", "นักจิตวิทยา/ผู้ให้คำปรึกษา", "อาจารย์", "อื่นๆ"]),
    comment: String(b.comment || "").slice(0, 1000),
  };
  try {
    await pushRecord("log:surveys", record);
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "store_error" });
  }
}
