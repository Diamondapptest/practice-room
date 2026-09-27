// ผู้รับบริการจำลองตอบกลับ และนับรอบฝึกรายวัน
import { CASES, RULES } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError } from "./_gemini.js";
import { hasStore, useRound, clientIp, validId } from "./_store.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns, device, session } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });
  if (!validId(device) || !validId(session)) return res.status(400).json({ error: "bad_id" });

  const history = cleanTurns(turns);
  if (!history.length || history[history.length - 1].role !== "user") {
    return res.status(400).json({ error: "bad_turns" });
  }

  let remaining = null;
  if (hasStore()) {
    try {
      const r = await useRound({ device, ip: clientIp(req), session });
      if (!r.ok) return res.status(429).json({ error: "daily_limit", remaining: 0 });
      remaining = r.remaining;
    } catch (e) {
      console.error("store error", e);
      // ถ้าฐานข้อมูลขัดข้อง ให้ฝึกต่อได้ ดีกว่าหยุดผู้ใช้ทั้งหมด
    }
  }

  // Gemini ต้องเริ่มบทสนทนาด้วยฝั่ง user จึงใส่ฉากเปิดไว้ก่อนคำพูดแรกของผู้รับบริการ
  const contents = history[0].role === "model"
    ? [{ role: "user", parts: [{ text: "(เริ่มเซสชัน ผู้รับบริการเพิ่งนั่งลง)" }] }, ...history]
    : history;

  try {
    const { text } = await callGemini({ system: RULES(c), contents, temperature: 0.9, maxTokens: 2048 });
    res.status(200).json({ reply: text, remaining });
  } catch (e) {
    sendError(res, e);
  }
}
