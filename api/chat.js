// ผู้รับบริการจำลองตอบกลับ พร้อมสภาวะภายในที่เปลี่ยนตามทักษะของผู้ฝึก
// ก่อนเล่นบท ตรวจก่อนว่าผู้ฝึกกำลังบอกความทุกข์ของตัวเองจริงหรือไม่ (แยกจากการเล่นบท)
import { CASES, RULES, clampState, RISK_WORDS, SELF_RISK_PROMPT } from "./_cases.js";
import { callGemini, guard, cleanTurns, sendError, parseJson } from "./_gemini.js";
import { hasStore, checkRound, commitRound, clientIp, validId, pushRecord, hash } from "./_store.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { caseId, turns, device, session, state, skipSafety } = req.body || {};
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return res.status(400).json({ error: "bad_case" });
  if (!validId(device) || !validId(session)) return res.status(400).json({ error: "bad_id" });

  const history = cleanTurns(turns);
  if (!history.length || history[history.length - 1].role !== "user") {
    return res.status(400).json({ error: "bad_turns" });
  }
  const cur = clampState(state, c.initState);
  const last = history[history.length - 1].parts[0].text;

  // 1) ตรวจความเสี่ยงของผู้ฝึกเอง: คัดด้วยคำก่อน แล้วค่อยให้ AI ตัดสินเฉพาะเมื่อมีคำเสี่ยง
  if (!skipSafety && RISK_WORDS.test(last)) {
    try {
      const ctx = history.slice(-4).map((t) => (t.role === "user" ? "ผู้ใช้: " : "ผู้รับบริการสมมติ: ") + t.parts[0].text).join("\n");
      const { text } = await callGemini({
        system: "คุณคือระบบคัดกรองความปลอดภัย ตอบเป็น JSON เท่านั้น",
        contents: [{ role: "user", parts: [{ text: SELF_RISK_PROMPT(ctx) }] }],
        json: true, temperature: 0, maxTokens: 512, lite: true,
      });
      const v = parseJson(text);
      if (v?.self_risk === true) {
        if (hasStore()) {
          try { await pushRecord("log:safety", { ts: new Date().toISOString(), user: hash(device), session, caseId }, 2000); } catch {}
        }
        return res.status(200).json({ safety: true });
      }
    } catch (e) {
      console.error("safety check failed", e);
      // ถ้าตรวจไม่ได้ ให้เล่นบทต่อ หน้าเว็บยังมีเบอร์สายด่วนแสดงตลอด
    }
  }

  // 2) นับรอบ
  let remaining = null, round = null;
  const who = { device, ip: clientIp(req), session };
  if (hasStore()) {
    try {
      round = await checkRound(who);
      if (!round.ok) return res.status(429).json({ error: "daily_limit", remaining: 0 });
      remaining = round.remaining;
    } catch (e) {
      console.error("store error", e);
    }
  }

  // 3) เล่นบท (Gemini ต้องเริ่มด้วยฝั่ง user จึงใส่ฉากเปิดไว้ก่อนคำพูดแรกของผู้รับบริการ)
  const contents = history[0].role === "model"
    ? [{ role: "user", parts: [{ text: "(เริ่มเซสชัน ผู้รับบริการเพิ่งนั่งลง)" }] }, ...history]
    : history;

  try {
    const { text } = await callGemini({ system: RULES(c, cur), contents, json: true, temperature: 0.9, maxTokens: 4096 });
    const out = parseJson(text);
    const reply = String(out?.reply || (out ? "" : text)).trim();
    if (!reply) throw { status: 502, code: "empty" };
    const next = clampState(out?.state, cur);
    // จำกัดการเปลี่ยนไม่เกิน 15 ต่อเทิร์น ตามกติกา
    for (const k of Object.keys(next)) next[k] = Math.max(cur[k] - 15, Math.min(cur[k] + 15, next[k]));
    if (round && !round.known) {
      try { await commitRound(who); } catch (e) { console.error("store error", e); }
    }
    res.status(200).json({ reply, state: next, why: String(out?.why || "").slice(0, 300), remaining });
  } catch (e) {
    sendError(res, e);
  }
}
