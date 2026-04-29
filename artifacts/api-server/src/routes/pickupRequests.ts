/**
 * pickupRequests.ts — API routes for stubble pickup requests.
 *
 * ROUTES:
 *   POST   /api/pickup-requests         — farmer creates a request (with holdUntilDays)
 *   GET    /api/pickup-requests         — list requests (role-filtered, runs auto-cancel sweep)
 *   GET    /api/pickup-requests/:id     — single request
 *   PATCH  /api/pickup-requests/:id     — aggregator accepts (with committedPickupDate) or updates status
 *
 * DATE / DEADLINE SYSTEM:
 *   - Farmer specifies holdUntilDays (3, 7, 14) → server stores holdUntilDate
 *   - Aggregator must specify committedPickupDate ≤ holdUntilDate when accepting
 *   - Auto-cancel sweep runs on every list/get: if status='accepted' and committedPickupDate < now,
 *     status becomes 'cancelled', cancelReason is set, aggregator's missedPickups increments,
 *     and the request gains 50 compensationCredits as an apology to the farmer.
 *   - If status='pending' and holdUntilDate < now, request auto-cancels with no penalty/compensation.
 */

import { Router, type IRouter } from "express";
import { db, pickupRequestsTable, usersTable } from "@workspace/db";
import { eq, desc, and, lt, gte, or, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { sendPushToUser } from "../lib/webPush";

const router: IRouter = Router();

const COMPENSATION_CREDITS = 50;

/* ─── Validation Schemas ─────────────────────────────────────── */

const CreatePickupSchema = z.object({
  cropType:      z.string().min(2),
  cropKey:       z.string().min(2),
  cropIcon:      z.string().default("🌾"),
  biomass:       z.number().positive(),
  fieldArea:     z.number().positive(),
  pricePerTon:   z.number().positive(),
  confidence:    z.number().int().min(1).max(100),
  lat:           z.number().finite().optional(),
  lng:           z.number().finite().optional(),
  /** How many days the farmer can hold this stubble before it must be picked up */
  holdUntilDays: z.number().int().min(1).max(60).default(7),
  /* ── Optional AI analysis snapshot ── */
  gradeLabel:        z.string().optional(),
  qualityRating:     z.number().int().min(1).max(5).optional(),
  residueFactor:     z.number().positive().optional(),
  residueColorNotes: z.string().optional(),
  recommendation:    z.string().optional(),
  bestUse:           z.string().optional(),
  aiNotes:           z.string().optional(),
  aiIssues:          z.array(z.string()).optional(),
});

const UpdateStatusSchema = z.object({
  status:              z.enum(["pending", "accepted", "collected", "cancelled"]),
  estimatedPickup:     z.string().optional(),
  /** ISO date string — required when status=accepted */
  committedPickupDate: z.string().datetime().optional(),
  cancelReason:        z.string().optional(),
});

/* ─── Auto-cancel sweep ──────────────────────────────────────── */
/**
 * Runs before any list/get. Two passes:
 *   1. Pending requests past holdUntilDate → cancelled (farmer's deadline elapsed)
 *   2. Accepted requests past committedPickupDate → cancelled with penalty + compensation
 */
async function runAutoCancelSweep(): Promise<void> {
  const now = new Date();

  // Pass 1: pending past hold-until
  await db
    .update(pickupRequestsTable)
    .set({
      status:       "cancelled",
      cancelledAt:  now,
      cancelReason: "Hold-until deadline expired without any aggregator accepting",
      updatedAt:    now,
    })
    .where(
      and(
        eq(pickupRequestsTable.status, "pending"),
        isNotNull(pickupRequestsTable.holdUntilDate),
        lt(pickupRequestsTable.holdUntilDate, now),
      ),
    );

  // Pass 2: accepted past committed-pickup → penalty + compensation
  const missed = await db
    .select({ id: pickupRequestsTable.id, aggregatorId: pickupRequestsTable.aggregatorId })
    .from(pickupRequestsTable)
    .where(
      and(
        eq(pickupRequestsTable.status, "accepted"),
        isNotNull(pickupRequestsTable.committedPickupDate),
        lt(pickupRequestsTable.committedPickupDate, now),
      ),
    );

  for (const m of missed) {
    await db
      .update(pickupRequestsTable)
      .set({
        status:               "cancelled",
        cancelledAt:          now,
        cancelReason:         "Aggregator missed their committed pickup date — order auto-cancelled",
        compensationCredits:  COMPENSATION_CREDITS,
        updatedAt:            now,
      })
      .where(eq(pickupRequestsTable.id, m.id));

    if (m.aggregatorId) {
      await db
        .update(usersTable)
        .set({ missedPickups: sql`${usersTable.missedPickups} + 1` })
        .where(eq(usersTable.id, m.aggregatorId));
    }
  }
}

/* ─── POST /api/pickup-requests ──────────────────────────────── */
router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).user;

  if (user.role !== "farmer") {
    res.status(403).json({ error: "Only farmers can create pickup requests" });
    return;
  }

  const parsed = CreatePickupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request data", details: parsed.error.issues });
    return;
  }

  const {
    cropType, cropKey, cropIcon, biomass, fieldArea, pricePerTon, confidence,
    lat, lng, holdUntilDays,
    gradeLabel, qualityRating, residueFactor, residueColorNotes,
    recommendation, bestUse, aiNotes, aiIssues,
  } = parsed.data;
  const pickupLat = lat ?? user.lat;
  const pickupLng = lng ?? user.lng;

  if (pickupLat == null || pickupLng == null) {
    res.status(400).json({ error: "Please save your field GPS location before requesting pickup" });
    return;
  }

  const holdUntilDate = new Date(Date.now() + holdUntilDays * 24 * 60 * 60 * 1000);

  const [request] = await db.insert(pickupRequestsTable).values({
    farmerId:    user.id,
    farmerName:  user.name,
    farmerPhone: user.phone,
    location:    user.location,
    lat:         pickupLat,
    lng:         pickupLng,
    cropType,
    cropKey,
    cropIcon,
    biomass,
    fieldArea,
    pricePerTon,
    confidence,
    status:      "pending",
    holdUntilDate,
    gradeLabel:        gradeLabel ?? null,
    qualityRating:     qualityRating ?? null,
    residueFactor:     residueFactor ?? null,
    residueColorNotes: residueColorNotes ?? null,
    recommendation:    recommendation ?? null,
    bestUse:           bestUse ?? null,
    aiNotes:           aiNotes ?? null,
    aiIssues:          aiIssues && aiIssues.length > 0 ? aiIssues.join("\n") : null,
  }).returning();

  res.status(201).json({ request, message: "Pickup request submitted" });
});

/* ─── GET /api/pickup-requests ───────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  await runAutoCancelSweep();

  const user = (req as any).user;
  let requests;

  if (user.role === "farmer") {
    // Farmer: only their own requests
    requests = await db
      .select()
      .from(pickupRequestsTable)
      .where(eq(pickupRequestsTable.farmerId, user.id))
      .orderBy(desc(pickupRequestsTable.createdAt));
  } else if (user.role === "aggregator") {
    // Aggregator: only requests created on or after they signed up,
    // AND either still available (pending) OR already claimed by them.
    // Other aggregators' accepted/collected/cancelled pickups stay hidden.
    requests = await db
      .select()
      .from(pickupRequestsTable)
      .where(and(
        gte(pickupRequestsTable.createdAt, user.createdAt),
        or(
          eq(pickupRequestsTable.status, "pending"),
          eq(pickupRequestsTable.aggregatorId, user.id),
        ),
      ))
      .orderBy(desc(pickupRequestsTable.createdAt));
  } else {
    // Factory: only pickups created on or after they signed up
    requests = await db
      .select()
      .from(pickupRequestsTable)
      .where(gte(pickupRequestsTable.createdAt, user.createdAt))
      .orderBy(desc(pickupRequestsTable.createdAt));
  }

  res.json({ requests });
});

/* ─── GET /api/pickup-requests/:id ──────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  await runAutoCancelSweep();

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [request] = await db
    .select()
    .from(pickupRequestsTable)
    .where(eq(pickupRequestsTable.id, id));

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  res.json({ request });
});

/* ─── PATCH /api/pickup-requests/:id ────────────────────────── */
router.patch("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  if (user.role !== "aggregator" && user.role !== "factory") {
    res.status(403).json({ error: "Only aggregators can update request status" });
    return;
  }

  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status data" });
    return;
  }

  const { status, estimatedPickup, committedPickupDate, cancelReason } = parsed.data;

  const [existing] = await db
    .select()
    .from(pickupRequestsTable)
    .where(eq(pickupRequestsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (status === "accepted") {
    if (!committedPickupDate) {
      res.status(400).json({ error: "committedPickupDate is required when accepting a pickup" });
      return;
    }
    const commit = new Date(committedPickupDate);
    if (existing.holdUntilDate && commit > existing.holdUntilDate) {
      res.status(400).json({
        error: "Committed pickup date cannot be later than the farmer's hold-until deadline",
      });
      return;
    }
    if (commit < new Date()) {
      res.status(400).json({ error: "Committed pickup date must be in the future" });
      return;
    }
    updateData.aggregatorId        = user.id;
    updateData.committedPickupDate = commit;
    updateData.estimatedPickup     = estimatedPickup ?? formatPickupEta(commit);
  }

  if (status === "cancelled") {
    updateData.cancelledAt  = new Date();
    updateData.cancelReason = cancelReason ?? "Cancelled by aggregator";
  }

  const [updated] = await db
    .update(pickupRequestsTable)
    .set(updateData)
    .where(eq(pickupRequestsTable.id, id))
    .returning();

  // Fire-and-forget web push to the affected farmer
  if (updated && updated.status !== existing.status) {
    const crop = updated.cropType ?? "Crop";
    let title = "AgriCycle update";
    let body  = `${crop} pickup is now ${updated.status}`;
    if (updated.status === "accepted") {
      title = "Pickup accepted";
      body  = `An aggregator accepted your ${crop} pickup. Get ready!`;
    } else if (updated.status === "collected") {
      title = "Pickup completed";
      body  = `Your ${crop} pickup is marked as collected — payment is on the way.`;
    } else if (updated.status === "cancelled") {
      title = "Pickup cancelled";
      body  = `Your ${crop} pickup was cancelled.`;
    }
    sendPushToUser(updated.farmerId, {
      title, body,
      tag:  `pickup-${updated.id}-${updated.status}`,
      url:  "/dashboard/farmer",
      data: { requestId: updated.id, status: updated.status },
    }).catch(() => {});
  }

  res.json({ request: updated, message: "Status updated" });
});

/* ─── PATCH /api/pickup-requests/:id/extend ─────────────────── */
/** Farmer extends the hold-until deadline for their own pending request */
const ExtendSchema = z.object({
  extraDays: z.number().int().min(1).max(30),
});

router.patch("/:id/extend", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  if (user.role !== "farmer") {
    res.status(403).json({ error: "Only farmers can extend their own pickup deadline" });
    return;
  }
  const parsed = ExtendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "extraDays must be 1-30" });
    return;
  }

  const [existing] = await db
    .select()
    .from(pickupRequestsTable)
    .where(eq(pickupRequestsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (existing.farmerId !== user.id) {
    res.status(403).json({ error: "Not your request" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(400).json({ error: "Only pending requests can have their deadline extended" });
    return;
  }

  const base = existing.holdUntilDate && existing.holdUntilDate > new Date()
    ? existing.holdUntilDate
    : new Date();
  const newDeadline = new Date(base.getTime() + parsed.data.extraDays * 86400000);

  // Cap total hold to 60 days from creation
  const maxHold = new Date(existing.createdAt.getTime() + 60 * 86400000);
  const finalDeadline = newDeadline > maxHold ? maxHold : newDeadline;

  const [updated] = await db
    .update(pickupRequestsTable)
    .set({ holdUntilDate: finalDeadline, updatedAt: new Date() })
    .where(eq(pickupRequestsTable.id, id))
    .returning();

  res.json({ request: updated, message: "Deadline extended" });
});

function formatPickupEta(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default router;
