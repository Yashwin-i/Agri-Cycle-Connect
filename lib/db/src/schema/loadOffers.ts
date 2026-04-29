/**
 * loadOffers.ts
 *
 * Aggregator → Factory direct load requests.
 *
 * Reverse of factory_demands: an aggregator who already has biomass on hand
 * (collected from farmers) sends a targeted offer to a specific factory
 * saying "I have X tons of crop Y, will sell at price Z per ton".
 *
 * FLOW:
 *   1. Aggregator picks a factory + fills crop/qty/price/notes
 *   2. POST /api/load-offers          → status: "pending"
 *   3. Factory sees it under their incoming offers
 *   4. Factory accepts (optional counter price) → status: "accepted"
 *      OR rejects with reason          → status: "rejected"
 *   5. Either side can mark fulfilled  → status: "fulfilled"
 *   6. Aggregator can cancel a pending offer → status: "cancelled"
 */

import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const loadOffersTable = pgTable("load_offers", {
  id:                  serial("id").primaryKey(),
  aggregatorId:        integer("aggregator_id").notNull().references(() => usersTable.id),
  aggregatorName:      text("aggregator_name").notNull(),
  aggregatorPhone:     text("aggregator_phone").notNull(),
  aggregatorLocation:  text("aggregator_location").notNull(),
  aggregatorLat:       real("aggregator_lat"),
  aggregatorLng:       real("aggregator_lng"),

  factoryId:           integer("factory_id").notNull().references(() => usersTable.id),
  factoryName:         text("factory_name").notNull(),
  factoryLocation:     text("factory_location").notNull(),

  cropType:            text("crop_type").notNull(),
  cropIcon:            text("crop_icon").notNull().default("🌾"),
  quantityTons:        real("quantity_tons").notNull(),
  /** aggregator's asking price */
  askingPricePerTon:   integer("asking_price_per_ton").notNull(),
  /** ISO date string — how long the load is being held available */
  availableUntil:      text("available_until").notNull(),
  notes:               text("notes"),

  /** pending → accepted | rejected | fulfilled | cancelled */
  status:              text("status", {
                          enum: ["pending", "accepted", "rejected", "fulfilled", "cancelled"],
                       })
                        .notNull()
                        .default("pending"),

  /** factory's agreed price (may differ from asking when negotiated) */
  agreedPricePerTon:   integer("agreed_price_per_ton"),
  /** rejection reason from factory, if any */
  rejectionReason:     text("rejection_reason"),
  fulfilledAt:         timestamp("fulfilled_at"),

  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull(),
});

export type LoadOffer       = typeof loadOffersTable.$inferSelect;
export type InsertLoadOffer = typeof loadOffersTable.$inferInsert;
