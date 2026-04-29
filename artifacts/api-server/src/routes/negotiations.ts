/**
 * negotiations.ts — chat-style price negotiation between aggregator & factory.
 *
 * ROUTES
 *   POST /api/factory-demands/:id/negotiations    aggregator opens a negotiation
 *   GET  /api/negotiations                        list negotiations for current user
 *   GET  /api/negotiations/:id                    fetch one negotiation + messages
 *   POST /api/negotiations/:id/messages           append a message (offer/text/accept/reject)
 */

import { Router, type IRouter } from "express";
import {
  db,
  factoryDemandsTable,
  demandNegotiationsTable,
  demandMessagesTable,
  usersTable,
} from "@workspace/db";
import { eq, or, desc, asc, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const StartNegotiationSchema = z.object({
  initialPrice: z.number().positive(),
  message:      z.string().optional(),
});

const MessageSchema = z.object({
  type:  z.enum(["text", "offer", "accept", "reject"]),
  price: z.number().positive().optional(),
  text:  z.string().optional(),
});

/* Helper: load negotiation + ensure current user is a participant */
async function loadAuthorizedNegotiation(id: number, userId: number) {
  const [neg] = await db
    .select()
    .from(demandNegotiationsTable)
    .where(eq(demandNegotiationsTable.id, id));
  if (!neg) return { error: "Negotiation not found", status: 404 } as const;
  if (neg.aggregatorId !== userId && neg.factoryId !== userId) {
    return { error: "Not authorised", status: 403 } as const;
  }
  return { neg } as const;
}

/* ─── POST /api/factory-demands/:demandId/negotiations ───────── */
export const demandNegotiationStart = Router();
demandNegotiationStart.post("/:demandId/negotiations", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const demandId = parseInt(req.params.demandId, 10);
  if (isNaN(demandId)) return void res.status(400).json({ error: "Invalid demand id" });
  if (user.role !== "aggregator")
    return void res.status(403).json({ error: "Only aggregators can start negotiations" });

  const parsed = StartNegotiationSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid payload" });

  const [demand] = await db.select().from(factoryDemandsTable).where(eq(factoryDemandsTable.id, demandId));
  if (!demand) return void res.status(404).json({ error: "Demand not found" });
  if (demand.status !== "open")
    return void res.status(409).json({ error: "Demand is no longer open" });

  // Reuse existing active negotiation if any
  const [existing] = await db
    .select()
    .from(demandNegotiationsTable)
    .where(and(
      eq(demandNegotiationsTable.demandId, demandId),
      eq(demandNegotiationsTable.aggregatorId, user.id),
    ));

  let negotiation = existing;
  if (!negotiation) {
    [negotiation] = await db.insert(demandNegotiationsTable).values({
      demandId,
      aggregatorId:   user.id,
      aggregatorName: user.name,
      factoryId:      demand.factoryId,
      status:         "active",
    }).returning();
  } else if (negotiation.status !== "active") {
    return void res.status(409).json({ error: "Negotiation is closed" });
  }

  // Append the initial offer message
  await db.insert(demandMessagesTable).values({
    negotiationId: negotiation.id,
    senderId:      user.id,
    senderRole:    "aggregator",
    type:          "offer",
    price:         Math.round(parsed.data.initialPrice),
    text:          parsed.data.message ?? null,
  });

  res.status(201).json({ negotiation, message: "Negotiation started" });
});

/* ─── GET /api/negotiations ─────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const negotiations = await db
    .select()
    .from(demandNegotiationsTable)
    .where(or(
      eq(demandNegotiationsTable.aggregatorId, user.id),
      eq(demandNegotiationsTable.factoryId,    user.id),
    ))
    .orderBy(desc(demandNegotiationsTable.updatedAt));

  // Hydrate with the parent demand and last message for each negotiation
  const demandIds = Array.from(new Set(negotiations.map(n => n.demandId)));
  const demands = demandIds.length
    ? await db.select().from(factoryDemandsTable).where(or(...demandIds.map(id => eq(factoryDemandsTable.id, id))))
    : [];
  const demandById = new Map(demands.map(d => [d.id, d]));

  const negIds = negotiations.map(n => n.id);
  const messages = negIds.length
    ? await db.select().from(demandMessagesTable)
        .where(or(...negIds.map(id => eq(demandMessagesTable.negotiationId, id))))
        .orderBy(asc(demandMessagesTable.createdAt))
    : [];

  const messagesByNeg = new Map<number, typeof messages>();
  for (const m of messages) {
    const list = messagesByNeg.get(m.negotiationId) ?? [];
    list.push(m);
    messagesByNeg.set(m.negotiationId, list);
  }

  const hydrated = negotiations.map(n => ({
    ...n,
    demand:   demandById.get(n.demandId) ?? null,
    messages: messagesByNeg.get(n.id) ?? [],
  }));

  res.json({ negotiations: hydrated });
});

/* ─── GET /api/negotiations/:id ─────────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

  const result = await loadAuthorizedNegotiation(id, user.id);
  if ("error" in result) return void res.status(result.status).json({ error: result.error });

  const [demand] = await db.select().from(factoryDemandsTable).where(eq(factoryDemandsTable.id, result.neg.demandId));
  const messages = await db.select().from(demandMessagesTable)
    .where(eq(demandMessagesTable.negotiationId, id))
    .orderBy(asc(demandMessagesTable.createdAt));

  res.json({ negotiation: { ...result.neg, demand, messages } });
});

/* ─── POST /api/negotiations/:id/messages ───────────────────── */
router.post("/:id/messages", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

  const parsed = MessageSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid message" });
  const { type, price, text } = parsed.data;

  const result = await loadAuthorizedNegotiation(id, user.id);
  if ("error" in result) return void res.status(result.status).json({ error: result.error });
  const neg = result.neg;
  if (neg.status !== "active")
    return void res.status(409).json({ error: "Negotiation is closed" });

  const senderRole: "aggregator" | "factory" = neg.aggregatorId === user.id ? "aggregator" : "factory";

  // Only counter-offers require a price from the client. For "accept" the
  // accepted price is derived server-side from the latest offer made by the
  // OTHER party (see below).
  if (type === "offer" && (!price || price <= 0)) {
    return void res.status(400).json({ error: "Price required" });
  }
  if (type === "text" && (!text || !text.trim())) {
    return void res.status(400).json({ error: "Message text required" });
  }

  // For 'accept', the accepted price is the latest offer from the OTHER party
  let acceptedPrice: number | null = null;
  if (type === "accept") {
    const [latestOtherOffer] = await db.select().from(demandMessagesTable)
      .where(and(
        eq(demandMessagesTable.negotiationId, id),
        eq(demandMessagesTable.type, "offer"),
      ))
      .orderBy(desc(demandMessagesTable.createdAt));
    if (!latestOtherOffer || latestOtherOffer.senderRole === senderRole) {
      return void res.status(400).json({ error: "No offer from the other party to accept" });
    }
    acceptedPrice = latestOtherOffer.price ?? price ?? null;
  }

  // Insert the message
  await db.insert(demandMessagesTable).values({
    negotiationId: id,
    senderId:      user.id,
    senderRole,
    type,
    price:  type === "accept" ? acceptedPrice : (price ?? null),
    text:   text ?? null,
  });

  // Side-effects
  if (type === "accept" && acceptedPrice) {
    // Mark this negotiation accepted
    await db.update(demandNegotiationsTable)
      .set({ status: "accepted", finalPrice: acceptedPrice, updatedAt: new Date() })
      .where(eq(demandNegotiationsTable.id, id));

    // Mark demand matched, set agreed price + matched aggregator
    await db.update(factoryDemandsTable)
      .set({
        status:              "matched",
        agreedPrice:         acceptedPrice,
        matchedAggregatorId: neg.aggregatorId,
        updatedAt:           new Date(),
      })
      .where(eq(factoryDemandsTable.id, neg.demandId));

    // Cancel any other active negotiations on the same demand
    await db.update(demandNegotiationsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(
        eq(demandNegotiationsTable.demandId, neg.demandId),
        eq(demandNegotiationsTable.status, "active"),
      ));
  } else if (type === "reject") {
    await db.update(demandNegotiationsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(demandNegotiationsTable.id, id));
  } else {
    await db.update(demandNegotiationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(demandNegotiationsTable.id, id));
  }

  // Return refreshed negotiation
  const [updated] = await db.select().from(demandNegotiationsTable).where(eq(demandNegotiationsTable.id, id));
  const messages = await db.select().from(demandMessagesTable)
    .where(eq(demandMessagesTable.negotiationId, id))
    .orderBy(asc(demandMessagesTable.createdAt));

  res.json({ negotiation: { ...updated, messages } });
});

export default router;
