// เรียก Gemini API (generateContent) ฝั่งเซิร์ฟเวอร์ API key ไม่ถูกส่งไปที่เบราว์เซอร์
// ลองโมเดลตามลำดับใน GEMINI_MODELS ถ้าตัวแรกเต็มโควตาหรือใช้ไม่ได้ จะลองตัวถัดไป

const DEFAULT_MODELS = "gemini-3.5-flash,gemini-3.1-flash-lite";

function models() {
  return (process.env.GEMINI_MODELS || DEFAULT_MODELS)
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export async function callGemini({ system, contents, json = false, temperature = 0.9, maxTokens = 2048 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw { status: 500, code: "no_key" };

  let lastErr = { status: 502, code: "upstream" };
  for (const model of models()) {
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
          },
        }),
      });
    } catch {
      lastErr = { status: 502, code: "upstream" };
      continue;
    }

    if (r.ok) {
      const data = await r.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
      if (text) return { text, model };
      const blocked = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason === "SAFETY";
      lastErr = { status: 502, code: blocked ? "refused" : "empty" };
      if (blocked) break;
      continue;
    }

    const detail = (await r.text()).slice(0, 400);
    console.error(`Gemini ${model} -> ${r.status}: ${detail}`);
    if (r.status === 429) lastErr = { status: 429, code: "rate_limited" };
    else if (r.status === 400 && /API key/i.test(detail)) { lastErr = { status: 500, code: "bad_key" }; break; }
    else lastErr = { status: 502, code: "upstream" };
    // 404 = ไม่มีโมเดลนี้, 429 = โควตาเต็ม, 5xx = ขัดข้องชั่วคราว → ลองโมเดลถัดไป
    if (![404, 429, 500, 503].includes(r.status)) break;
  }
  throw lastErr;
}

// ตรวจรหัสเข้าใช้ (ถ้าตั้ง ACCESS_CODE ไว้) และขนาดข้อมูล เพื่อกันคนนอกมาใช้โควตาฟรีจนหมด
export function guard(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return false; }
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
  res.status(status).json({ error: e?.code || "upstream" });
}
