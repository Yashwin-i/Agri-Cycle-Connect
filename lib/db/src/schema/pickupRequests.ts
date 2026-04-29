/**
 * pickupRequests.ts
 *
 * Database schema for stubble pickup requests.
 *
 * DATA FLOW:
 *   1. Farmer fills out FarmerDashboard → POST /api/pickup-requests
 *   2. Status starts as "pending"
 *   3. Aggregator fetches all pending requests in their dashboard
 *   4. Aggregator accepts → PATCH /api/pickup-requests/:id { status: "accepted" }
 *   5. Farmer dashboard polls and shows "Pickup Scheduled" when status changes
 *   6. After collection → status becomes "collected"
 */

import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const pickupRequestsTable = pgTable("pickup_requests", {
  id:               serial("id").primaryKey(),
  farmerId:         integer("farmer_id").notNull().references(() => usersTable.id),
  farmerName:       text("farmer_name").notNull(),
  farmerPhone:      text("farmer_phone").notNull(),
  location:         text("location").notNull(),
  /** Approximate latitude derived from location string (for map display) */
  lat:              real("lat"),
  /** Approximate longitude derived from location string (for map display) */
  lng:              real("lng"),
  cropType:         text("crop_type").notNull(),         // human label e.g. "Rice Straw"
  cropKey:          text("crop_key").notNull(),          // machine key e.g. "rice"
  cropIcon:         text("crop_icon").notNull().default("🌾"),
  biomass:          real("biomass").notNull(),           // tons
  fieldArea:        real("field_area").notNull(),        // acres
  pricePerTon:      integer("price_per_ton").notNull(),  // ₹ per ton
  confidence:       integer("confidence").notNull(),     // model confidence %
  /* ── Optional AI analysis snapshot (filled when farmer creates from AI result) ── */
  gradeLabel:        text("grade_label"),         // "Premium" | "Good" | "Average" | "Poor"
  qualityRating:     integer("quality_rating"),   // 1-5 stars
  residueFactor:     real("residue_factor"),      // tons / acre used in estimate
  residueColorNotes: text("residue_color_notes"), // short colour/dryness note
  recommendation:    text("recommendation"),      // long-form best-use guidance
  bestUse:           text("best_use"),            // short label e.g. "Briquettes / Ethanol"
  aiNotes:           text("ai_notes"),            // 1-2 sentence farmer summary
  aiIssues:          text("ai_issues"),           // newline-separated issue list
  /** pending → accepted → collected, or cancelled at any point */
  status:           text("status", { enum: ["pending", "accepted", "collected", "cancelled"] })
                      .notNull()
                      .default("pending"),
  /** ID of aggregator who accepted this request (null if still pending) */
  aggregatorId:     integer("aggregator_id").references(() => usersTable.id),
  /** Human-readable ETA set by aggregator on accept */
  estimatedPickup:  text("estimated_pickup"),
  /** Latest date by which the farmer can hold the stubble before they need to burn or dispose */
  holdUntilDate:    timestamp("hold_until_date"),
  /** Date by which the aggregator commits to picking up (must be ≤ holdUntilDate) */
  committedPickupDate: timestamp("committed_pickup_date"),
  /** Set when the request is cancelled (auto or manual) */
  cancelledAt:      timestamp("cancelled_at"),
  /** Reason text for the cancellation, shown to farmer */
  cancelReason:     text("cancel_reason"),
  /** Eco credits awarded to the farmer as apology when an aggregator misses commitment */
  compensationCredits: integer("compensation_credits").notNull().default(0),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
});

export type PickupRequest = typeof pickupRequestsTable.$inferSelect;
export type InsertPickupRequest = typeof pickupRequestsTable.$inferInsert;
