/**
 * factoryDemands.ts — API routes for factory procurement demands.
 *
 * ROUTES:
 *   POST  /api/factory-demands            — factory posts a new demand
 *   GET   /api/factory-demands            — list all open demands (all roles)
 *   PATCH /api/factory-demands/:id        — factory closes/updates demand
 *   POST  /api/factory-demands/:id/bid   — aggregator submits a price bid
 */

import { Router, type IRouter } from "express";
import { db, factoryDemandsTable, usersTable } from "@workspace/db";
import { eq, desc, and, or, gte } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const CreateDemandSchema = z.object({
  cropType:     z.string().min(2),
  cropIcon:     z.string().default("🌾"),
  quantityTons: z.number().positive(),
  pricePerTon:  z.number().positive(),
  deadline:     z.string().min(5),
  notes:        z.string().optional(),
});

const UpdateDemandSchema = z.object({
  status:      z.enum(["open", "matched", "fulfilled", "closed"]).optional(),
  agreedPrice: z.number().positive().optional(),
  matchedAggregatorId: z.number().int().positive().optional(),
});

const BidDemandSchema = z.object({
  agreedPrice: z.number().positive(),
});

/* ─── POST /api/factory-demands ──────────────────────────────── */
router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).user;

  if (user.role !== "factory") {
    res.status(403).json({ error: "Only factories can post demands" });
    return;
  }

  const parsed = CreateDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid demand data", details: parsed.error.issues });
    return;
  }

  const { cropType, cropIcon, quantityTons, pricePerTon, deadline, notes } = parsed.data;

  const [demand] = await db.insert(factoryDemandsTable).values({
    factoryId:       user.id,
    factoryName:     user.name,
    factoryLocation: user.location,
    factoryLat:      user.lat ?? null,
    factoryLng:      user.lng ?? null,
    cropType,
    cropIcon,
    quantityTons,
    pricePerTon,
    deadline,
    notes: notes ?? null,
    status: "open",
  }).returning();

  res.status(201).json({ demand, message: "Demand posted" });
});

/* ─── GET /api/factory-demands ───────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).user;
  let demands;

  if (user.role === "factory") {
    // Factory: only their own posted demands
    demands = await db
      .select()
      .from(factoryDemandsTable)
      .where(eq(factoryDemandsTable.factoryId, user.id))
      .orderBy(desc(factoryDemandsTable.createdAt));
  } else if (user.role === "aggregator") {
    // Aggregator: only demands posted at-or-after their signup,
    // AND either still open OR matched/fulfilled by them.
    demands = await db
      .select()
      .from(factoryDemandsTable)
      .where(and(
        gte(factoryDemandsTable.createdAt, user.createdAt),
        or(
          eq(factoryDemandsTable.status, "open"),
          eq(factoryDemandsTable.matchedAggregatorId, user.id),
        ),
      ))
      .orderBy(desc(factoryDemandsTable.createdAt));
  } else {
    // Farmer (or any other role): demands aren't relevant
    demands = [];
  }

  res.json({ demands });
});

/* ─── PATCH /api/factory-demands/:id ────────────────────────── */
router.patch("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(factoryDemandsTable)
    .where(eq(factoryDemandsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Demand not found" });
    return;
  }

  if (user.role !== "factory" || existing.factoryId !== user.id) {
    res.status(403).json({ error: "Not authorised" });
    return;
  }

  const parsed = UpdateDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.status)               updateData.status = parsed.data.status;
  if (parsed.data.agreedPrice)          updateData.agreedPrice = parsed.data.agreedPrice;
  if (parsed.data.matchedAggregatorId)  updateData.matchedAggregatorId = parsed.data.matchedAggregatorId;

  const [updated] = await db
    .update(factoryDemandsTable)
    .set(updateData)
    .where(eq(factoryDemandsTable.id, id))
    .returning();

  res.json({ demand: updated, message: "Demand updated" });
});

/* ─── DELETE /api/factory-demands/:id ───────────────────────── */
router.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(factoryDemandsTable)
    .where(eq(factoryDemandsTable.id, id));

  if (!existing || existing.factoryId !== user.id) {
    res.status(404).json({ error: "Not found or not authorised" });
    return;
  }

  await db.delete(factoryDemandsTable).where(eq(factoryDemandsTable.id, id));
  res.json({ message: "Demand deleted" });
});

/* ─── POST /api/factory-demands/:id/bid ───────────────────────── */
router.post("/:id/bid", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  if (user.role !== "aggregator") {
    res.status(403).json({ error: "Only aggregators can submit offers" });
    return;
  }

  const parsed = BidDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid offer price" });
    return;
  }

  const [existing] = await db
    .select()
    .from(factoryDemandsTable)
    .where(eq(factoryDemandsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Demand not found" });
    return;
  }

  if (existing.status !== "open") {
    res.status(409).json({ error: "This demand is no longer open" });
    return;
  }

  const [updated] = await db
    .update(factoryDemandsTable)
    .set({
      status: "matched",
      agreedPrice: parsed.data.agreedPrice,
      matchedAggregatorId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(factoryDemandsTable.id, id))
    .returning();

  res.json({ demand: updated, message: "Offer submitted and demand matched" });
});

/* ─── POST /api/factory-demands/:id/fulfill ───────────────────── */
router.post("/:id/fulfill", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(factoryDemandsTable)
    .where(eq(factoryDemandsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Demand not found" });
    return;
  }
  if (user.role !== "factory" || existing.factoryId !== user.id) {
    res.status(403).json({ error: "Only the requesting factory can mark fulfilled" });
    return;
  }
  if (existing.status !== "matched") {
    res.status(409).json({ error: "Demand must be in matched state to fulfill" });
    return;
  }

  const [updated] = await db
    .update(factoryDemandsTable)
    .set({
      status:      "fulfilled",
      fulfilledAt: new Date(),
      updatedAt:   new Date(),
    })
    .where(eq(factoryDemandsTable.id, id))
    .returning();

  res.json({ demand: updated, message: "Delivery marked as fulfilled" });
});

export default router;
