/**
 * push.ts — Web Push subscription management endpoints.
 *
 *   GET    /api/push/vapid-public-key        — returns base64url public key
 *   POST   /api/push/subscribe                — store (or upsert) a subscription
 *   POST   /api/push/unsubscribe              — remove a subscription by endpoint
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { VAPID_PUBLIC_KEY, sendPushToUser } from "../lib/webPush";

const router: IRouter = Router();

router.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

const SubscribeSchema = z.object({
  endpoint:  z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth:   z.string().min(4),
  }),
  userAgent: z.string().max(500).optional(),
});

router.post("/subscribe", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const parsed = SubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid subscription", details: parsed.error.issues });
    return;
  }
  const { endpoint, keys, userAgent } = parsed.data;

  // Upsert by endpoint (one subscription per browser/device)
  const [existing] = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  if (existing) {
    await db.update(pushSubscriptionsTable)
      .set({ userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent })
      .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      userId: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth:   keys.auth,
      userAgent,
    });
  }

  // Send a welcome ping so the user knows it's working end-to-end
  await sendPushToUser(user.id, {
    title: "AgriCycle alerts on",
    body:  "You'll get notified about pickup updates even when this app is closed.",
    tag:   "agricycle-welcome",
    url:   user.role === "farmer" ? "/dashboard/farmer" : "/dashboard/aggregator",
  });

  res.json({ ok: true });
});

const UnsubscribeSchema = z.object({ endpoint: z.string().url() });

router.post("/unsubscribe", requireAuth, async (req, res) => {
  const parsed = UnsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid endpoint" });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint));
  res.json({ ok: true });
});

export default router;
