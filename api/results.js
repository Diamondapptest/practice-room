// ดาวน์โหลดผลแบบสอบถามหรือผลประเมินเป็นไฟล์ CSV (เปิดใน Google Sheets หรือ Excel ได้)
// ใช้: /api/results?key=ADMIN_KEY&type=surveys   หรือ   &type=evaluations   หรือ   &type=safety
import { hasStore, readRecords } from "./_store.js";

const csvCell = (v) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${s.replace(/"/g, '""')}"`;
};

export default async function handler(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query?.key !== key) return res.status(401).send("ต้องใส่ ADMIN_KEY ที่ถูกต้อง");
  if (!hasStore()) return res.status(503).send("ยังไม่ได้เชื่อมฐานข้อมูล");

  const type = ["evaluations", "safety"].includes(req.query?.type) ? req.query.type : "surveys";
  const rows = await readRecords("log:" + type);
  const cols = {
    surveys: ["ts", "caseId", "rating", "realistic", "useAgain", "pay", "role", "comment", "user", "session"],
    evaluations: ["ts", "caseId", "turns", "scores", "stages", "failures", "finalState", "transcript", "user", "session"],
    safety: ["ts", "caseId", "user", "session"],
  }[type];
  // แสดงเวลาเป็นเวลาไทย อ่านง่ายใน Google Sheets
  const thai = (iso) => new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  const lines = [cols.map((c) => (c === "ts" ? "time_th" : c)).join(",")]
    .concat(rows.map((r) => cols.map((c) => csvCell(c === "ts" ? thai(r.ts) : r[c])).join(",")));

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send("﻿" + lines.join("\n"));
}
