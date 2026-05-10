import { pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core'

export const messageStats = pgTable('message_stats', {
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const wordStats = pgTable('word_stats', {
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  word: text('word').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const autoDrawSettings = pgTable('auto_draw_settings', {
  guildId: text('guild_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  hour: smallint('hour').notNull(),
  minute: smallint('minute').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})
