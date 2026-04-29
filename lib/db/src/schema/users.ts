import { pgTable, text, serial, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["farmer", "aggregator", "factory"] }).notNull(),
  location: text("location").notNull(),
  /** GPS latitude — collected via browser geolocation or map pin */
  lat: real("lat"),
  /** GPS longitude */
  lng: real("lng"),
  /** Aggregator-only: count of pickups they committed to but missed */
  missedPickups: integer("missed_pickups").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
