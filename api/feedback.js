// ผู้คุมการฝึก AI ประเมินบทสนทนาแล้วส่งผลเป็น JSON
import { CASES, FEEDBACK_PROMPT } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError } from "./_gemini.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });

  const history = cleanTurns(turns, 80);
  if (!history.some((t) => t.role === "user")) return res.status(400).json({ error: "bad_turns" });

  const transcript = history
    .map((t) => (t.role === "user" ? "ผู้ฝึก: " : c.name + ": ") + t.parts[0].text)
    .join("\n")
    .slice(-30000);

  try {
    const { text } = await callGemini({
      system: "คุณคือผู้คุมการฝึกด้านจิตวิทยาการปรึกษา ตอบเป็น JSON ที่ถูกต้องเท่านั้น",
      contents: [{ role: "user", parts: [{ text: FEEDBACK_PROMPT(c, transcript) }] }],
      json: true,
      temperature: 0.4,
      maxTokens: 8192,
    });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw { status: 502, code: "invalid_json" };
      data = JSON.parse(m[0]);
    }
    res.status(200).json(data);
  } catch (e) {
    sendError(res, e?.status ? e : { status: 502, code: "invalid_json" });
  }
}
