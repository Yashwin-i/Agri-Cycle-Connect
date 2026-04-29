/**
 * demandNegotiations.ts
 *
 * Chat-based price negotiation between an aggregator and a factory
 * for a specific factory demand.
 *
 * - One negotiation per (demand, aggregator) pair.
 * - status: active → accepted (deal struck) | rejected | cancelled
 * - Messages stream contains text, offer (with price), accept, reject events.
 */

import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { factoryDemandsTable } from "./factoryDemands";

export const demandNegotiationsTable = pgTable("demand_negotiations", {
  id:             serial("id").primaryKey(),
  demandId:       integer("demand_id").notNull().references(() => factoryDemandsTable.id, { onDelete: "cascade" }),
  aggregatorId:   integer("aggregator_id").notNull().references(() => usersTable.id),
  aggregatorName: text("aggregator_name").notNull(),
  factoryId:      integer("factory_id").notNull().references(() => usersTable.id),
  status:         text("status", { enum: ["active", "accepted", "rejected", "cancelled"] })
                    .notNull().default("active"),
  finalPrice:     integer("final_price"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
});

export const demandMessagesTable = pgTable("demand_messages", {
  id:              serial("id").primaryKey(),
  negotiationId:   integer("negotiation_id").notNull().references(() => demandNegotiationsTable.id, { onDelete: "cascade" }),
  senderId:        integer("sender_id").notNull().references(() => usersTable.id),
  senderRole:      text("sender_role", { enum: ["aggregator", "factory"] }).notNull(),
  type:            text("type", { enum: ["text", "offer", "accept", "reject"] }).notNull(),
  price:           integer("price"),
  text:            text("text"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export type DemandNegotiation = typeof demandNegotiationsTable.$inferSelect;
export type DemandMessage     = typeof demandMessagesTable.$inferSelect;
