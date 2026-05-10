import { Pool } from 'pg'
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

const databaseUrl = process.env.DATABASE_URL
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined
})

function assertDatabaseUrl() {
  if (!databaseUrl) {
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

export async function trackMessage(args: {
  guildId: string
  userId: string
  content: string
}) {
  assertDatabaseUrl()

  const words = await analyzeWords(args.content)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      'INSERT INTO message_stats (guild_id, user_id, created_at) VALUES ($1, $2, now())',
      [args.guildId, args.userId]
    )

    if (words.length > 0) {
      const values = words
        .map((_, index) => `($1, $2, $${index + 3}, now())`)
        .join(',')
      await client.query(
        `INSERT INTO word_stats (guild_id, user_id, word, created_at) VALUES ${values}`,
        [args.guildId, args.userId, ...words]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
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

  const rank = normalizePositiveInt(args.rank, 10)
  const pageSize = normalizePositiveInt(args.pageSize, PAGE_SIZE)
  const page = normalizeNonNegativeInt(args.page, 0)

  const start = getPeriodStart(args.period)
  const baseWhere =
    args.scope === 'user' ? 'guild_id = $1 AND user_id = $2' : 'guild_id = $1'
  const baseParams =
    args.scope === 'user' ? [args.guildId, args.userId] : [args.guildId]
  const timeClause = start ? ` AND created_at >= $${baseParams.length + 1}` : ''
  const params = start ? [...baseParams, start] : baseParams

  const messageCountQuery = `
    SELECT COUNT(*)::int AS count
    FROM message_stats
    WHERE ${baseWhere}${timeClause}
  `
  const messageCountRes = await pool.query<{ count: number }>(
    messageCountQuery,
    params
  )
  const totalMessages = messageCountRes.rows[0]?.count ?? 0

  let participantCount: number | undefined
  if (args.scope === 'guild') {
    const participantQuery = `
      SELECT COUNT(DISTINCT user_id)::int AS count
      FROM message_stats
      WHERE ${baseWhere}${timeClause}
    `
    const participantRes = await pool.query<{ count: number }>(
      participantQuery,
      params
    )
    participantCount = participantRes.rows[0]?.count ?? 0
  }

  const wordCountQuery = `
    SELECT COUNT(DISTINCT word)::int AS count
    FROM word_stats
    WHERE ${baseWhere}${timeClause}
  `
  const wordCountRes = await pool.query<{ count: number }>(
    wordCountQuery,
    params
  )
  const totalWordCount = wordCountRes.rows[0]?.count ?? 0
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

  const limit = Math.min(pageSize, totalCount - offset)
  const limitParamIndex = params.length + 1
  const offsetParamIndex = params.length + 2
  const wordQuery = `
    SELECT word, COUNT(*)::int AS count
    FROM word_stats
    WHERE ${baseWhere}${timeClause}
    GROUP BY word
    ORDER BY count DESC, word ASC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `

  const wordRes = await pool.query<StatsWordRow>(wordQuery, [
    ...params,
    limit,
    offset
  ])
  const words = wordRes.rows
  const hasNext = offset + limit < totalCount

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

  const pageSize = normalizePositiveInt(args.pageSize, PARTICIPANT_PAGE_SIZE)
  const page = normalizeNonNegativeInt(args.page, 0)

  const start = getPeriodStart(args.period)
  const timeClause = start ? ' AND created_at >= $2' : ''
  const params = start ? [args.guildId, start] : [args.guildId]

  const countQuery = `
    SELECT COUNT(DISTINCT user_id)::int AS count
    FROM message_stats
    WHERE guild_id = $1${timeClause}
  `
  const countRes = await pool.query<{ count: number }>(countQuery, params)
  const totalCount = countRes.rows[0]?.count ?? 0

  const offset = page * pageSize
  if (offset >= totalCount) {
    return {
      userIds: [],
      totalCount,
      hasNext: false
    }
  }

  const limit = Math.min(pageSize, totalCount - offset)
  const limitParamIndex = params.length + 1
  const offsetParamIndex = params.length + 2
  const idsQuery = `
    SELECT user_id
    FROM message_stats
    WHERE guild_id = $1${timeClause}
    GROUP BY user_id
    ORDER BY MAX(created_at) DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `
  const idsRes = await pool.query<{ user_id: string }>(idsQuery, [
    ...params,
    limit,
    offset
  ])
  const userIds = idsRes.rows.map(row => row.user_id)
  const hasNext = offset + limit < totalCount

  return {
    userIds,
    totalCount,
    hasNext
  }
}
