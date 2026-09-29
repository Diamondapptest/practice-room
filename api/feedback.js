// ผู้คุมการฝึก AI ประเมินการฝึกตาม 9 สมรรถนะ พร้อมขั้นเซสชัน คำอธิบายรายข้อความ และข้อผิดพลาดที่พบบ่อย
import { CASES, FEEDBACK_PROMPT, SKILLS, STAGES, TAGS, FAILURES } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError, parseJson } from "./_gemini.js";
import { hasStore, sessionKnown, pushRecord, validId, hash } from "./_store.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x, n = 600) => String(x ?? "").slice(0, n);

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns, device, session, states } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });
  if (!validId(device) || !validId(session)) return res.status(400).json({ error: "bad_id" });

  const history = cleanTurns(turns, 80);
  const userCount = history.filter((t) => t.role === "user").length;
  if (!userCount) return res.status(400).json({ error: "bad_turns" });

  if (hasStore()) {
    try {
      if (!(await sessionKnown(device, session))) return res.status(429).json({ error: "daily_limit" });
    } catch (e) { console.error("store error", e); }
  }

  let n = 0;
  const transcript = history
    .map((t) => (t.role === "user" ? `[T${++n}] ผู้ฝึก: ` : c.name + ": ") + t.parts[0].text)
    .join("\n")
    .slice(-30000);
  const stateLine = arr(states).slice(0, 80)
    .map((s, i) => `#${i}:${[s?.trust, s?.anxiety, s?.defensiveness, s?.insight].map((v) => Math.round(Number(v) || 0)).join("/")}`)
    .join(" ") || "ไม่มีข้อมูล";

  let data;
  try {
    const { text } = await callGemini({
      system: "คุณคือผู้คุมการฝึกด้านจิตวิทยาการปรึกษา ตอบเป็น JSON ที่ถูกต้องเท่านั้น",
      contents: [{ role: "user", parts: [{ text: FEEDBACK_PROMPT(c, transcript, stateLine) }] }],
      json: true, temperature: 0.3, maxTokens: 12000,
    });
    data = parseJson(text);
    if (!data) throw { status: 502, code: "invalid_json" };
  } catch (e) {
    return sendError(res, e?.status ? e : { status: 502, code: "invalid_json" });
  }

  // จัดรูปแบบให้ครบและปลอดภัย แม้โมเดลจะตอบไม่ครบ
  const byName = new Map(arr(data.scores).map((s) => [str(s?.skill, 60), s]));
  const clean = {
    overall: str(data.overall, 800),
    scores: SKILLS.map((k) => {
      const s = byName.get(k) || arr(data.scores).find((x) => str(x?.skill).includes(k.slice(0, 6)));
      return { skill: k, score: Math.max(0, Math.min(5, Math.round(Number(s?.score) || 0))), note: str(s?.note, 300) };
    }),
    stages: STAGES.map((k) => {
      const s = arr(data.stages).find((x) => str(x?.stage).includes(k.slice(0, 4)));
      return { stage: k, done: Boolean(s?.done), note: str(s?.note, 200) };
    }),
    annotations: arr(data.annotations)
      .map((a) => ({ turn: Math.round(Number(a?.turn) || 0), tags: arr(a?.tags).filter((t) => TAGS.includes(t)).slice(0, 3), note: str(a?.note, 300) }))
      .filter((a) => a.turn >= 1 && a.turn <= userCount),
    failures: arr(data.failures)
      .map((f) => ({ type: str(f?.type, 40), turn: Math.round(Number(f?.turn) || 0), note: str(f?.note, 300) }))
      .filter((f) => FAILURES.includes(f.type)),
    strengths: arr(data.strengths).slice(0, 4).map((x) => str(x, 300)),
    missed: arr(data.missed).slice(0, 4).map((x) => str(x, 300)),
    formulation: str(data.formulation, 800),
    risk: str(data.risk, 800),
    reflection: arr(data.reflection).slice(0, 4).map((x) => str(x, 300)),
  };

  if (hasStore()) {
    try {
      await pushRecord("log:evaluations", {
        ts: new Date().toISOString(), session, user: hash(device), caseId, turns: userCount,
        scores: Object.fromEntries(clean.scores.map((s) => [s.skill, s.score])),
        stages: Object.fromEntries(clean.stages.map((s) => [s.stage, s.done])),
        failures: clean.failures.map((f) => f.type),
        finalState: arr(states).slice(-1)[0] || null,
        transcript,
      });
    } catch (e) { console.error("store error", e); }
  }
  res.status(200).json(clean);
}
