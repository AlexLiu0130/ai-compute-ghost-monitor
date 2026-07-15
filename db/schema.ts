import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  payload: text("payload").notNull(),
  publishedAt: text("published_at").notNull().default(""),
});

export const captureStatus = sqliteTable("capture_status", {
  id: integer("id").primaryKey(),
  fetched: integer("fetched").notNull().default(0),
  captured: integer("captured").notNull().default(0),
  stored: integer("stored").notNull().default(0),
  status: text("status").notNull().default("ready"),
  errors: text("errors").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(""),
});
