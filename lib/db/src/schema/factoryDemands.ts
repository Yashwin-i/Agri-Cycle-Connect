/**
 * factoryDemands.ts
 *
 * Schema for factory procurement demands — requirements posted by
 * factories for biomass that aggregators can fulfil.
 *
 * DATA FLOW:
 *   1. Factory posts a demand via POST /api/factory-demands
 *   2. Aggregators see all open demands in their dashboard
 *   3. Aggregator bids a price via POST /api/factory-demands/:id/bid
 *   4. Factory reviews bids and accepts/rejects via PATCH /api/factory-demands/:id
 */

import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const factoryDemandsTable = pgTable("factory_demands", {
  id:             serial("id").primaryKey(),
  factoryId:      integer("factory_id").notNull().references(() => usersTable.id),
  factoryName:    text("factory_name").notNull(),
  factoryLocation: text("factory_location").notNull(),
  factoryLat:     real("factory_lat"),
  factoryLng:     real("factory_lng"),
  cropType:       text("crop_type").notNull(),
  cropIcon:       text("crop_icon").notNull().default("🌾"),
  quantityTons:   real("quantity_tons").notNull(),
  pricePerTon:    integer("price_per_ton").notNull(),  // factory's offered price
  deadline:       text("deadline").notNull(),           // ISO date string
  notes:          text("notes"),
  /** open → matched (deal accepted) → fulfilled (factory received) → closed */
  status:         text("status", { enum: ["open", "matched", "fulfilled", "closed"] })
                    .notNull()
                    .default("open"),
  /** when the factory marked the delivery as received */
  fulfilledAt:    timestamp("fulfilled_at"),
  /** winning aggregator's offered price (if matched) */
  agreedPrice:    integer("agreed_price"),
  /** ID of the aggregator who was matched */
  matchedAggregatorId: integer("matched_aggregator_id").references(() => usersTable.id),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
});

export type FactoryDemand = typeof factoryDemandsTable.$inferSelect;
export type InsertFactoryDemand = typeof factoryDemandsTable.$inferInsert;
