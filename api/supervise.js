// โหมดผู้คุมการฝึก: หยุดพักกลางเซสชันเพื่อขอคำชี้แนะ ได้ไม่เกิน 3 ครั้งต่อรอบ ไม่ตัดรอบฝึก
import { CASES, SUPERVISE_PROMPT, clampState } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError, parseJson } from "./_gemini.js";
import { hasStore, redis, sessionKnown, validId } from "./_store.js";

export const SUPERVISE_LIMIT = 3;

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns, device, session, state } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });
  if (!validId(device) || !validId(session)) return res.status(400).json({ error: "bad_id" });
  const history = cleanTurns(turns, 60);
  if (!history.some((t) => t.role === "user")) return res.status(400).json({ error: "bad_turns" });

  let used = 0;
  if (hasStore()) {
    try {
      if (!(await sessionKnown(device, session))) return res.status(429).json({ error: "daily_limit" });
      const [n] = await redis([["INCR", `sup:${session}`], ["EXPIRE", `sup:${session}`, 172800]]);
      used = Number(n) || 0;
      if (used > SUPERVISE_LIMIT) return res.status(429).json({ error: "supervise_limit" });
    } catch (e) { console.error("store error", e); }
  }

  const transcript = history.map((t) => (t.role === "user" ? "ผู้ฝึก: " : c.name + ": ") + t.parts[0].text).join("\n").slice(-20000);
  try {
    const { text } = await callGemini({
      system: "คุณคือผู้คุมการฝึกด้านจิตวิทยาการปรึกษา ตอบเป็น JSON เท่านั้น",
      contents: [{ role: "user", parts: [{ text: SUPERVISE_PROMPT(c, transcript, clampState(state, c.initState)) }] }],
      json: true, temperature: 0.4, maxTokens: 3000,
    });
    const d = parseJson(text) || {};
    res.status(200).json({
      stage: String(d.stage || "").slice(0, 60),
      observation: String(d.observation || "").slice(0, 500),
      prompts: (Array.isArray(d.prompts) ? d.prompts : []).slice(0, 3).map((p) => String(p).slice(0, 300)),
      left: used ? Math.max(0, SUPERVISE_LIMIT - used) : null,
    });
  } catch (e) {
    sendError(res, e);
  }
}
