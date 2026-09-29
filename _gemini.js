// เรียก Gemini API (generateContent) ฝั่งเซิร์ฟเวอร์ API key ไม่ถูกส่งไปที่เบราว์เซอร์
// ลองโมเดลตามลำดับใน GEMINI_MODELS ถ้าตัวแรกเต็มโควตาหรือใช้ไม่ได้ จะลองตัวถัดไป

const DEFAULT_MODELS = "gemini-3.5-flash,gemini-3.1-flash-lite";

function models() {
  return (process.env.GEMINI_MODELS || DEFAULT_MODELS)
    .split(",").map((s) => s.trim()).filter(Boolean);
}

// อ่าน JSON จากคำตอบของโมเดล แม้จะมีข้อความหรือ code fence ปนมา
export function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// จำว่าโมเดลไหนไม่รองรับการตั้งระดับการคิด จะได้ไม่ส่งซ้ำ (อยู่ได้ตลอดอายุ instance)
const noThinkingConfig = new Set();

// lite = ใช้โมเดลตัวท้ายของรายการ (เร็วและประหยัด) สำหรับงานสั้นๆ เช่นตรวจความเสี่ยง
// think = "low" ให้โมเดลคิดสั้นลง ตอบเร็วขึ้น (ใช้กับการเล่นบท) ถ้าโมเดลไม่รองรับจะลองใหม่โดยไม่ตั้งค่านี้
export async function callGemini({ system, contents, json = false, temperature = 0.9, maxTokens = 2048, lite = false, think = null }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw { status: 500, code: "no_key" };

  const list = lite ? models().slice(-1).concat(models().slice(0, -1)) : models();
  let lastErr = { status: 502, code: "upstream" };

  for (const model of list) {
    let withThink = Boolean(think) && !noThinkingConfig.has(model);
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              ...(json ? { responseMimeType: "application/json" } : {}),
              ...(withThink ? { thinkingConfig: { thinkingLevel: think } } : {}),
            },
          }),
        });
      } catch (e) {
        console.error(`Gemini ${model} fetch failed: ${e?.message}`);
        lastErr = { status: 502, code: "upstream", upstream: "network" };
        await sleep(800);
        continue;
      }

      if (r.ok) {
        const data = await r.json();
        const cand = data?.candidates?.[0];
        const parts = cand?.content?.parts || [];
        const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
        if (text) return { text, model };
        const blocked = data?.promptFeedback?.blockReason || cand?.finishReason === "SAFETY";
        console.error(`Gemini ${model} empty: finish=${cand?.finishReason}`);
        lastErr = { status: 502, code: blocked ? "refused" : "empty", upstream: cand?.finishReason || "none" };
        if (blocked) throw lastErr;
        break; // ลองโมเดลถัดไป
      }

      const detail = (await r.text()).slice(0, 500);
      console.error(`Gemini ${model} -> ${r.status}: ${detail}`);
      lastErr = { status: 502, code: "upstream", upstream: r.status };
      if (r.status === 400 && /API key/i.test(detail)) throw { status: 500, code: "bad_key" };
      if (r.status === 400 && withThink && /think/i.test(detail)) {
        noThinkingConfig.add(model); withThink = false; continue; // โมเดลนี้ไม่รองรับ ลองใหม่ทันที
      }
      if (r.status === 429) { lastErr = { status: 429, code: "rate_limited" }; break; }
      if ([500, 502, 503, 504].includes(r.status)) { await sleep(700 * (attempt + 1)); continue; } // ขัดข้องชั่วคราว ลองซ้ำ
      if (r.status === 404) break; // ไม่มีโมเดลนี้ ลองตัวถัดไป
      throw lastErr;
    }
  }
  throw lastErr;
}

// ตรวจเมธอด และรหัสเข้าใช้ (เฉพาะเมื่อตั้ง ACCESS_CODE ไว้)
export function guard(req, res, method = "POST") {
  if (req.method !== method) { res.status(405).json({ error: "method_not_allowed" }); return false; }
  const code = process.env.ACCESS_CODE;
  if (code && req.headers["x-access-code"] !== code) { res.status(401).json({ error: "need_code" }); return false; }
  return true;
}

// ทำความสะอาดบทสนทนาจากเบราว์เซอร์: จำกัดจำนวนและความยาว และรวมเทิร์นที่บทบาทเดียวกันติดกัน
export function cleanTurns(turns, maxTurns = 60) {
  if (!Array.isArray(turns)) return [];
  const out = [];
  for (const t of turns.slice(-maxTurns)) {
    const role = t?.role === "assistant" ? "model" : t?.role === "user" ? "user" : null;
    const text = String(t?.content ?? "").slice(0, 1500).trim();
    if (!role || !text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else out.push({ role, parts: [{ text }] });
  }
  return out;
}

export function sendError(res, e) {
  const status = e?.status || 500;
  res.status(status).json({ error: e?.code || "upstream", ...(e?.upstream ? { upstream: e.upstream } : {}) });
}
