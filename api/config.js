// ค่าตั้งที่หน้าเว็บต้องรู้ และจำนวนรอบที่เหลือของวันนี้
import { hasStore, DAILY_LIMIT, roundsLeft, validId } from "./_store.js";

export default async function handler(req, res) {
  const device = String(req.query?.device || "");
  let remaining = null;
  if (hasStore() && validId(device)) {
    try { remaining = await roundsLeft(device); } catch (e) { console.error("store error", e); }
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    limit: DAILY_LIMIT,
    remaining,
    stored: hasStore(),
    contact: process.env.CONTACT_EMAIL || "",
    needCode: Boolean(process.env.ACCESS_CODE),
  });
}
