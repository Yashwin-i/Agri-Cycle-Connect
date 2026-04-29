import { Request } from "express";

const SESSION_COOKIE = "agricycle_session";

export function setSession(res: any, userId: number): void {
  const payload = Buffer.from(JSON.stringify({ userId })).toString("base64");
  res.cookie(SESSION_COOKIE, payload, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSession(res: any): void {
  res.clearCookie(SESSION_COOKIE);
}

export function getSessionUserId(req: Request): number | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cookie, "base64").toString("utf-8"));
    return typeof decoded.userId === "number" ? decoded.userId : null;
  } catch {
    return null;
  }
}
