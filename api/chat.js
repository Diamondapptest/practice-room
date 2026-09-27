// ผู้รับบริการจำลองตอบกลับ
import { CASES, RULES } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError } from "./_gemini.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });

  const history = cleanTurns(turns);
  if (!history.length || history[history.length - 1].role !== "user") {
    return res.status(400).json({ error: "bad_turns" });
  }
  // Gemini ต้องเริ่มบทสนทนาด้วยฝั่ง user จึงใส่ฉากเปิดไว้ก่อนคำพูดแรกของผู้รับบริการ
  const contents = history[0].role === "model"
    ? [{ role: "user", parts: [{ text: "(เริ่มเซสชัน ผู้รับบริการเพิ่งนั่งลง)" }] }, ...history]
    : history;

  try {
    const { text } = await callGemini({ system: RULES(c), contents, temperature: 0.9, maxTokens: 2048 });
    res.status(200).json({ reply: text });
  } catch (e) {
    sendError(res, e);
  }
}
