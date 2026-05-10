import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db, pool } from './db'
import { autoDrawSettings, messageStats, wordStats } from './schema'
import { analyzeWords } from './tokenizer'
import {
  PAGE_SIZE,
  PARTICIPANT_PAGE_SIZE,
  type ParticipantPageResult,
  type Period,
  type Scope,
  type StatsPageResult,
  type StatsWordRow
} from './types'

export type AutoDrawConfig = {
  guildId: string
  channelId: string
  hour: number
  minute: number
}

export type AutoDrawRepository = {
  isConfigured: () => boolean
  ensureTable: () => Promise<void>
  getAllConfigs: () => Promise<AutoDrawConfig[]>
  getConfigByGuildId: (guildId: string) => Promise<AutoDrawConfig | null>
  upsertConfig: (config: AutoDrawConfig) => Promise<void>
  deleteConfig: (guildId: string) => Promise<void>
}

function assertDatabaseUrl() {
  if (!pool) {
    throw new Error('DATABASE_URL is not set in environment variables.')
  }
}

function getPeriodStart(period: Period): Date | null {
  if (period === 'all') return null
  const now = new Date()
  if (period === 'day') now.setDate(now.getDate() - 1)
  if (period === 'week') now.setDate(now.getDate() - 7)
  if (period === 'month') now.setMonth(now.getMonth() - 1)
  return now
}

function normalizePositiveInt(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  if (floored <= 0) return fallback
  return floored
}

function normalizeNonNegativeInt(value: number, fallback = 0) {
  if (!Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  if (floored < 0) return fallback
  return floored
}

function buildScopeConditions(scope: Scope, guildId: string, userId: string) {
  const conditions = [eq(messageStats.guildId, guildId)]
  if (scope === 'user') {
    conditions.push(eq(messageStats.userId, userId))
  }
  return conditions
}

function buildWordScopeConditions(
  scope: Scope,
  guildId: string,
  userId: string
) {
  const conditions = [eq(wordStats.guildId, guildId)]
  if (scope === 'user') {
    conditions.push(eq(wordStats.userId, userId))
  }
  return conditions
}

async function ensureAutoDrawTable() {
  assertDatabaseUrl()
  if (!pool) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_draw_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
      minute SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 59),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function getAllAutoDrawConfigs() {
  assertDatabaseUrl()
  if (!db) return []

  const rows = await db.select().from(autoDrawSettings)
  return rows.map(row => ({
    guildId: row.guildId,
    channelId: row.channelId,
    hour: row.hour,
    minute: row.minute
  }))
}

async function getAutoDrawConfigByGuildId(guildId: string) {
  assertDatabaseUrl()
  if (!db) return null

  const rows = await db
    .select()
    .from(autoDrawSettings)
    .where(eq(autoDrawSettings.guildId, guildId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    guildId: row.guildId,
    channelId: row.channelId,
    hour: row.hour,
    minute: row.minute
  }
}

async function upsertAutoDrawConfig(config: AutoDrawConfig) {
  assertDatabaseUrl()
  if (!db) return

  await db
    .insert(autoDrawSettings)
    .values({
      guildId: config.guildId,
      channelId: config.channelId,
      hour: config.hour,
      minute: config.minute,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: autoDrawSettings.guildId,
      set: {
        channelId: config.channelId,
        hour: config.hour,
        minute: config.minute,
        updatedAt: new Date()
      }
    })
}

async function deleteAutoDrawConfig(guildId: string) {
  assertDatabaseUrl()
  if (!db) return

  await db.delete(autoDrawSettings).where(eq(autoDrawSettings.guildId, guildId))
}

export const autoDrawRepository: AutoDrawRepository = {
  isConfigured: () => Boolean(pool),
  ensureTable: ensureAutoDrawTable,
  getAllConfigs: getAllAutoDrawConfigs,
  getConfigByGuildId: getAutoDrawConfigByGuildId,
  upsertConfig: upsertAutoDrawConfig,
  deleteConfig: deleteAutoDrawConfig
}

export async function trackMessage(args: {
  guildId: string
  userId: string
  content: string
}) {
  assertDatabaseUrl()
  if (!db) return

  const words = await analyzeWords(args.content)

  await db.insert(messageStats).values({
    guildId: args.guildId,
    userId: args.userId,
    createdAt: new Date()
  })

  if (words.length > 0) {
    await db.insert(wordStats).values(
      words.map(word => ({
        guildId: args.guildId,
        userId: args.userId,
        word,
        createdAt: new Date()
      }))
    )
  }
}

export async function fetchStatsPage(args: {
  scope: Scope
  period: Period
  rank: number
  page: number
  pageSize: number
  userId: string
  guildId: string
}): Promise<StatsPageResult> {
  assertDatabaseUrl()
  if (!db) {
    return {
      totalMessages: 0,
      words: [],
      totalCount: 0,
      hasNext: false
    }
  }

  const rank = normalizePositiveInt(args.rank, 10)
  const pageSize = normalizePositiveInt(args.pageSize, PAGE_SIZE)
  const page = normalizeNonNegativeInt(args.page, 0)
  const start = getPeriodStart(args.period)

  const messageConditions = buildScopeConditions(
    args.scope,
    args.guildId,
    args.userId
  )
  if (start) messageConditions.push(gte(messageStats.createdAt, start))

  const messageCountRows = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(messageStats)
    .where(and(...messageConditions))
  const totalMessages = messageCountRows[0]?.count ?? 0

  let participantCount: number | undefined
  if (args.scope === 'guild') {
    const participantRows = await db
      .select({
        count: sql<number>`cast(count(distinct ${messageStats.userId}) as int)`
      })
      .from(messageStats)
      .where(and(...messageConditions))
    participantCount = participantRows[0]?.count ?? 0
  }

  const wordConditions = buildWordScopeConditions(
    args.scope,
    args.guildId,
    args.userId
  )
  if (start) wordConditions.push(gte(wordStats.createdAt, start))

  const totalWordRows = await db
    .select({
      count: sql<number>`cast(count(distinct ${wordStats.word}) as int)`
    })
    .from(wordStats)
    .where(and(...wordConditions))
  const totalWordCount = totalWordRows[0]?.count ?? 0
  const totalCount = Math.min(rank, totalWordCount)

  const offset = page * pageSize
  if (offset >= totalCount) {
    return {
      totalMessages,
      words: [],
      totalCount,
      hasNext: false,
      participantCount
    }
  }

  const wordRows = await db
    .select({
      word: wordStats.word,
      count: sql<number>`cast(count(*) as int)`
    })
    .from(wordStats)
    .where(and(...wordConditions))
    .groupBy(wordStats.word)

  const sortedWords = wordRows
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count
      return left.word.localeCompare(right.word)
    })
    .slice(offset, offset + pageSize)

  const words: StatsWordRow[] = sortedWords.map(row => ({
    word: row.word,
    count: row.count
  }))

  const hasNext = offset + pageSize < totalCount

  return {
    totalMessages,
    words,
    totalCount,
    hasNext,
    participantCount
  }
}

export async function fetchParticipantsPage(args: {
  period: Period
  page: number
  pageSize: number
  guildId: string
}): Promise<ParticipantPageResult> {
  assertDatabaseUrl()
  if (!db) {
    return {
      userIds: [],
      totalCount: 0,
      hasNext: false
    }
  }

  const pageSize = normalizePositiveInt(args.pageSize, PARTICIPANT_PAGE_SIZE)
  const page = normalizeNonNegativeInt(args.page, 0)
  const start = getPeriodStart(args.period)

  const conditions = [eq(messageStats.guildId, args.guildId)]
  if (start) conditions.push(gte(messageStats.createdAt, start))

  const countRows = await db
    .select({
      count: sql<number>`cast(count(distinct ${messageStats.userId}) as int)`
    })
    .from(messageStats)
    .where(and(...conditions))
  const totalCount = countRows[0]?.count ?? 0

  const offset = page * pageSize
  if (offset >= totalCount) {
    return {
      userIds: [],
      totalCount,
      hasNext: false
    }
  }

  const groupedRows = await db
    .select({
      userId: messageStats.userId,
      latestAt: sql<Date>`max(${messageStats.createdAt})`
    })
    .from(messageStats)
    .where(and(...conditions))
    .groupBy(messageStats.userId)

  const sortedRows = groupedRows
    .sort((left, right) => right.latestAt.getTime() - left.latestAt.getTime())
    .slice(offset, offset + pageSize)

  const userIds = sortedRows.map(row => row.userId)
  const hasNext = offset + pageSize < totalCount

  return {
    userIds,
    totalCount,
    hasNext
  }
}
