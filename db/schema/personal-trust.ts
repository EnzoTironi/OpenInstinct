import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const personalTrustInvites = pgTable(
  "personal_trust_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "personal_trust_invites_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'declined')`
    ),
    check(
      "personal_trust_invites_pair_check",
      sql`${table.fromUserId} <> ${table.toUserId}`
    ),
    index("personal_trust_invites_recipient_idx").on(
      table.toUserId,
      table.status
    ),
    uniqueIndex("personal_trust_invites_pending_uidx")
      .on(table.fromUserId, table.toUserId)
      .where(sql`${table.status} = 'pending'`),
  ]
);

export const personalTrustEdges = pgTable(
  "personal_trust_edges",
  {
    userId: text("user_id").notNull(),
    peerUserId: text("peer_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.peerUserId] }),
    check(
      "personal_trust_edges_pair_check",
      sql`${table.userId} <> ${table.peerUserId}`
    ),
    index("personal_trust_edges_peer_idx").on(table.peerUserId),
  ]
);

export const personalTrustBlocks = pgTable(
  "personal_trust_blocks",
  {
    userId: text("user_id").notNull(),
    blockedUserId: text("blocked_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.blockedUserId] }),
    check(
      "personal_trust_blocks_pair_check",
      sql`${table.userId} <> ${table.blockedUserId}`
    ),
  ]
);
