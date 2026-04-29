/**
 * loadOffers.ts — API routes for aggregator → factory load offers.
 *
 * ROUTES
 *   POST   /api/load-offers            aggregator creates an offer to a specific factory
 *   GET    /api/load-offers            list offers visible to current user (role-filtered)
 *   PATCH  /api/load-offers/:id/accept factory accepts (optionally counter price)
 *   PATCH  /api/load-offers/:id/reject factory rejects with optional reason
 *   PATCH  /api/load-offers/:id/fulfill mark as fulfilled (factory or aggregator)
 *   DELETE /api/load-offers/:id        aggregator cancels their own pending offer
 */

import { Router, type IRouter } from "express";
import { db, loadOffersTable, usersTable } from "@workspace/db";
import { eq, or, desc, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const CreateOfferSchema = z.object({
  factoryId:         z.number().int().positive(),
  cropType:          z.string().min(2),
  cropIcon:          z.string().default("🌾"),
  quantityTons:      z.number().positive(),
  askingPricePerTon: z.number().positive(),
  availableUntil:    z.string().min(5),
  notes:             z.string().optional(),
});

const AcceptSchema = z.object({
  agreedPricePerTon: z.number().positive().optional(),
});

const RejectSchema = z.object({
  reason: z.string().optional(),
});

/* ─── POST /api/load-offers ──────────────────────────────────── */
router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).user;

  if (user.role !== "aggregator") {
    res.status(403).json({ error: "Only aggregators can send load offers" });
    return;
  }

  const parsed = CreateOfferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid offer data", details: parsed.error.issues });
    return;
  }

  // Verify the target factory exists and is a factory
  const [factory] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, parsed.data.factoryId));

  if (!factory || factory.role !== "factory") {
    res.status(404).json({ error: "Target factory not found" });
    return;
  }

  const [offer] = await db.insert(loadOffersTable).values({
    aggregatorId:       user.id,
    aggregatorName:     user.name,
    aggregatorPhone:    user.phone,
    aggregatorLocation: user.location,
    aggregatorLat:      user.lat ?? null,
    aggregatorLng:      user.lng ?? null,
    factoryId:          factory.id,
    factoryName:        factory.name,
    factoryLocation:    factory.location,
    cropType:           parsed.data.cropType,
    cropIcon:           parsed.data.cropIcon,
    quantityTons:       parsed.data.quantityTons,
    askingPricePerTon:  parsed.data.askingPricePerTon,
    availableUntil:     parsed.data.availableUntil,
    notes:              parsed.data.notes ?? null,
    status:             "pending",
  }).returning();

  res.status(201).json({ offer, message: "Load offer sent" });
});

/* ─── GET /api/load-offers ───────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).user;

  let rows;
  if (user.role === "aggregator") {
    rows = await db
      .select()
      .from(loadOffersTable)
      .where(eq(loadOffersTable.aggregatorId, user.id))
      .orderBy(desc(loadOffersTable.createdAt));
  } else if (user.role === "factory") {
    rows = await db
      .select()
      .from(loadOffersTable)
      .where(eq(loadOffersTable.factoryId, user.id))
      .orderBy(desc(loadOffersTable.createdAt));
  } else {
    rows = [];
  }

  res.json({ offers: rows });
});

/* ─── PATCH /api/load-offers/:id/accept ─────────────────────── */
router.patch("/:id/accept", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = AcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const [existing] = await db
    .select()
    .from(loadOffersTable)
    .where(eq(loadOffersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  if (user.role !== "factory" || existing.factoryId !== user.id) {
    res.status(403).json({ error: "Only the target factory can accept" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Offer is no longer pending" });
    return;
  }

  const agreed = parsed.data.agreedPricePerTon ?? existing.askingPricePerTon;
  const [updated] = await db
    .update(loadOffersTable)
    .set({
      status:            "accepted",
      agreedPricePerTon: agreed,
      updatedAt:         new Date(),
    })
    .where(eq(loadOffersTable.id, id))
    .returning();

  res.json({ offer: updated, message: "Offer accepted" });
});

/* ─── PATCH /api/load-offers/:id/reject ─────────────────────── */
router.patch("/:id/reject", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = RejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const [existing] = await db
    .select()
    .from(loadOffersTable)
    .where(eq(loadOffersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  if (user.role !== "factory" || existing.factoryId !== user.id) {
    res.status(403).json({ error: "Only the target factory can reject" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Offer is no longer pending" });
    return;
  }

  const [updated] = await db
    .update(loadOffersTable)
    .set({
      status:          "rejected",
      rejectionReason: parsed.data.reason ?? null,
      updatedAt:       new Date(),
    })
    .where(eq(loadOffersTable.id, id))
    .returning();

  res.json({ offer: updated, message: "Offer rejected" });
});

/* ─── PATCH /api/load-offers/:id/fulfill ────────────────────── */
router.patch("/:id/fulfill", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select()
    .from(loadOffersTable)
    .where(eq(loadOffersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  if (existing.factoryId !== user.id && existing.aggregatorId !== user.id) {
    res.status(403).json({ error: "Not authorised" });
    return;
  }
  if (existing.status !== "accepted") {
    res.status(409).json({ error: "Offer must be accepted before fulfilling" });
    return;
  }

  const [updated] = await db
    .update(loadOffersTable)
    .set({
      status:      "fulfilled",
      fulfilledAt: new Date(),
      updatedAt:   new Date(),
    })
    .where(eq(loadOffersTable.id, id))
    .returning();

  res.json({ offer: updated, message: "Offer marked fulfilled" });
});

/* ─── DELETE /api/load-offers/:id ───────────────────────────── */
router.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select()
    .from(loadOffersTable)
    .where(eq(loadOffersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  if (user.role !== "aggregator" || existing.aggregatorId !== user.id) {
    res.status(403).json({ error: "Only the offering aggregator can cancel" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Only pending offers can be cancelled" });
    return;
  }

  const [updated] = await db
    .update(loadOffersTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(loadOffersTable.id, id))
    .returning();

  res.json({ offer: updated, message: "Offer cancelled" });
});

export default router;
