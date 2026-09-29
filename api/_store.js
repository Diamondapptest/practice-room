// ที่เก็บข้อมูล (Upstash Redis ผ่าน REST) สำหรับจำกัดจำนวนรอบ บันทึกความยินยอม ผลประเมิน และแบบสอบถาม
// ถ้ายังไม่ได้เชื่อมฐานข้อมูล ระบบยังใช้งานได้ แต่จะจำกัดรอบได้แค่ฝั่งเบราว์เซอร์ และไม่เก็บแบบสอบถาม
import crypto from "node:crypto";

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const DAILY_LIMIT = Math.max(1, parseInt(process.env.DAILY_LIMIT || "3", 10) || 3);
// เพดานต่อ IP กันบอท ตั้งสูงไว้เพราะนักศึกษาในมหาวิทยาลัยมักใช้ Wi-Fi (IP) เดียวกัน
export const IP_DAILY_LIMIT = Math.max(DAILY_LIMIT, parseInt(process.env.IP_DAILY_LIMIT || "60", 10) || 60);
export const hasStore = () => Boolean(URL_ && TOKEN);

export async function redis(commands) {
  const r = await fetch(`${URL_.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw { status: 502, code: "store_error" };
  const out = await r.json();
  return out.map((x) => x?.result);
}

// วันที่ตามเวลาไทย ใช้เป็นรอบรีเซ็ตโควตารายวัน
export function bkkDate() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

const SALT = process.env.HASH_SALT || process.env.GEMINI_API_KEY || "practice-room";
export const hash = (s) => crypto.createHash("sha256").update(SALT + "|" + s).digest("hex").slice(0, 24);

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim() || "unknown";
}

export const validId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s);

// นับรอบฝึก: หนึ่งรอบ = หนึ่งเซสชันที่ AI ตอบข้อความแรกสำเร็จ ไม่ว่าจะเป็นตัวละครไหน
function roundKeys(device, ip) {
  const day = bkkDate();
  return { dKey: `rounds:${day}:d:${hash(device)}`, iKey: `rounds:${day}:ip:${hash(ip)}` };
}

// ตรวจก่อนเรียก AI ว่ายังมีรอบเหลือไหม (ยังไม่ตัดรอบ)
export async function checkRound({ device, ip, session }) {
  const { dKey, iKey } = roundKeys(device, ip);
  const [isMember, dCount, iCount] = await redis([["SISMEMBER", dKey, session], ["SCARD", dKey], ["SCARD", iKey]]);
  if (isMember) return { ok: true, known: true, remaining: Math.max(0, DAILY_LIMIT - dCount) };
  if (dCount >= DAILY_LIMIT || iCount >= IP_DAILY_LIMIT) return { ok: false, remaining: 0 };
  return { ok: true, known: false, remaining: Math.max(0, DAILY_LIMIT - dCount - 1) };
}

// ตัดรอบหลังจาก AI ตอบสำเร็จแล้วเท่านั้น
export async function commitRound({ device, ip, session }) {
  const { dKey, iKey } = roundKeys(device, ip);
  await redis([["SADD", dKey, session], ["EXPIRE", dKey, 172800], ["SADD", iKey, session], ["EXPIRE", iKey, 172800]]);
}

export async function roundsLeft(device) {
  const [n] = await redis([["SCARD", `rounds:${bkkDate()}:d:${hash(device)}`]]);
  return Math.max(0, DAILY_LIMIT - (n || 0));
}

export async function sessionKnown(device, session) {
  const [m] = await redis([["SISMEMBER", `rounds:${bkkDate()}:d:${hash(device)}`, session]]);
  return Boolean(m);
}

// เก็บบันทึกแบบรายการ เก็บล่าสุดไม่เกิน max รายการ
export async function pushRecord(list, record, max = 5000) {
  await redis([["LPUSH", list, JSON.stringify(record)], ["LTRIM", list, 0, max - 1]]);
}

export async function readRecords(list, max = 5000) {
  const [rows] = await redis([["LRANGE", list, 0, max - 1]]);
  return (rows || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}
