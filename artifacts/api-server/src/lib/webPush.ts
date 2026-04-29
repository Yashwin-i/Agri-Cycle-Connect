/**
 * webPush.ts — VAPID key bootstrap + push delivery helper.
 *
 * On first run we generate a VAPID key pair and persist it to .local/vapid.json
 * (gitignored) so subsequent boots reuse the same keys. Set VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY env vars to override and use a managed key pair instead.
 *
 * Public key is exposed via GET /api/push/vapid-public-key so the browser can
 * subscribe with PushManager.subscribe({ applicationServerKey }).
 */
import webpush from "web-push";
import fs from "node:fs";
import path from "node:path";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const VAPID_FILE = path.resolve(process.cwd(), "../../.local/vapid.json");
const SUBJECT = process.env["VAPID_SUBJECT"] ?? "mailto:notifications@agricycle.local";

interface VapidKeys { publicKey: string; privateKey: string; }

function loadOrCreateKeys(): VapidKeys {
  const envPub = process.env["VAPID_PUBLIC_KEY"];
  const envPriv = process.env["VAPID_PRIVATE_KEY"];
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };

  try {
    if (fs.existsSync(VAPID_FILE)) {
      const raw = fs.readFileSync(VAPID_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) return parsed;
    }
  } catch { /* fall through */ }

  const fresh = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(fresh, null, 2));
    console.log("[webPush] Generated new VAPID key pair → " + VAPID_FILE);
  } catch (e) {
    console.warn("[webPush] Could not persist VAPID keys:", e);
  }
  return fresh;
}

const keys = loadOrCreateKeys();
webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);

export const VAPID_PUBLIC_KEY = keys.publicKey;

export interface PushPayload {
  title: string;
  body:  string;
  tag?:  string;
  url?:  string;
  data?: Record<string, unknown>;
}

/** Send a push notification to every device subscribed by `userId`. */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  if (subs.length === 0) return;

  const json = JSON.stringify(payload);

  await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
      );
    } catch (err: any) {
      // 404/410 means the subscription is gone — clean it up
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, s.endpoint));
      } else {
        console.warn("[webPush] Send failed for sub", s.id, err?.statusCode ?? err?.message);
      }
    }
  }));
}
