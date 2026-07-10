import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  payload: text("payload").notNull(),
  publishedAt: text("published_at").notNull().default(""),
});
