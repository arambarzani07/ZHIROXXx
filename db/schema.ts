import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const posMarkets = sqliteTable("pos_markets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status", { enum: ["trial", "active", "suspended"] }).notNull().default("trial"),
  ownerActorId: text("owner_actor_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("pos_markets_slug_unique").on(table.slug),
  index("pos_markets_owner_idx").on(table.ownerActorId),
]);

export const posMarketMemberships = sqliteTable("pos_market_memberships", {
  marketId: text("market_id").notNull(),
  actorId: text("actor_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "manager", "cashier", "accountant"] }).notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.marketId, table.actorId] }),
  uniqueIndex("pos_market_memberships_email_unique").on(table.marketId, table.email),
  index("pos_market_memberships_actor_idx").on(table.actorId, table.active),
]);

export const posSyncMutations = sqliteTable("pos_sync_mutations", {
  tenantId: text("tenant_id").notNull(),
  mutationId: text("mutation_id").notNull(),
  baseRevision: integer("base_revision").notNull(),
  revision: integer("revision"),
  status: text("status", { enum: ["pending", "completed"] }).notNull().default("pending"),
  deviceId: text("device_id").notNull(),
  actorId: text("actor_id").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.mutationId] }),
  uniqueIndex("pos_sync_mutations_revision_unique").on(table.tenantId, table.revision),
  index("pos_sync_mutations_status_revision_idx").on(table.tenantId, table.status, table.revision),
]);

export const posSyncChanges = sqliteTable("pos_sync_changes", {
  tenantId: text("tenant_id").notNull(),
  mutationId: text("mutation_id").notNull(),
  storeName: text("store_name").notNull(),
  recordId: text("record_id").notNull(),
  operation: text("operation", { enum: ["upsert"] }).notNull().default("upsert"),
  payloadJson: text("payload_json").notNull(),
  digest: text("digest").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.mutationId, table.storeName, table.recordId] }),
  index("pos_sync_changes_record_idx").on(table.tenantId, table.storeName, table.recordId),
]);

export const posStaff = sqliteTable("pos_staff", {
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "manager", "cashier", "accountant"] }).notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.actorId] }),
  uniqueIndex("pos_staff_email_unique").on(table.tenantId, table.email),
]);

export const posDevices = sqliteTable("pos_devices", {
  tenantId: text("tenant_id").notNull(),
  deviceId: text("device_id").notNull(),
  label: text("label").notNull(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  appVersion: integer("app_version").notNull(),
  lastRevision: integer("last_revision").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  conflictCount: integer("conflict_count").notNull().default(0),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.deviceId] }),
  index("pos_devices_seen_idx").on(table.tenantId, table.lastSeenAt),
]);

export const posRestorePoints = sqliteTable("pos_restore_points", {
  tenantId: text("tenant_id").notNull(),
  day: text("day").notNull(),
  revision: integer("revision").notNull(),
  recordCount: integer("record_count").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.day] }),
  index("pos_restore_points_revision_idx").on(table.tenantId, table.revision),
]);
