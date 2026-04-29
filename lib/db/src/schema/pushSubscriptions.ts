import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint:  text("endpoint").notNull().unique(),
  p256dh:    text("p256dh").notNull(),
  auth:      text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;
