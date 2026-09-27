// ผู้คุมการฝึก AI ประเมินการฝึก แล้วเก็บผลประเมินแบบไม่ระบุตัวตน
import { CASES, FEEDBACK_PROMPT } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError } from "./_gemini.js";
import { hasStore, sessionKnown, pushRecord, validId, hash } from "./_store.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns, device, session } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });
  if (!validId(device) || !validId(session)) return res.status(400).json({ error: "bad_id" });

  const history = cleanTurns(turns, 80);
  if (!history.some((t) => t.role === "user")) return res.status(400).json({ error: "bad_turns" });

  // ประเมินได้เฉพาะรอบที่ถูกนับแล้ว กันการเรียกประเมินซ้ำโดยไม่ผ่านการนับรอบ
  if (hasStore()) {
    try {
      if (!(await sessionKnown(device, session))) return res.status(429).json({ error: "daily_limit" });
    } catch (e) { console.error("store error", e); }
  }

  const transcript = history
    .map((t) => (t.role === "user" ? "ผู้ฝึก: " : c.name + ": ") + t.parts[0].text)
    .join("\n")
    .slice(-30000);

  let data;
  try {
    const { text } = await callGemini({
      system: "คุณคือผู้คุมการฝึกด้านจิตวิทยาการปรึกษา ตอบเป็น JSON ที่ถูกต้องเท่านั้น",
      contents: [{ role: "user", parts: [{ text: FEEDBACK_PROMPT(c, transcript) }] }],
      json: true,
      temperature: 0.4,
      maxTokens: 8192,
    });
    try {
      data = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw { status: 502, code: "invalid_json" };
      data = JSON.parse(m[0]);
    }
  } catch (e) {
    return sendError(res, e?.status ? e : { status: 502, code: "invalid_json" });
  }

  if (hasStore()) {
    try {
      const scores = Object.fromEntries((Array.isArray(data?.scores) ? data.scores : []).map((s) => [String(s.skill), Number(s.score) || 0]));
      await pushRecord("log:evaluations", {
        ts: new Date().toISOString(), session, user: hash(device), caseId, turns: history.filter((t) => t.role === "user").length,
        scores, transcript,
      });
    } catch (e) { console.error("store error", e); }
  }
  res.status(200).json(data);
}
