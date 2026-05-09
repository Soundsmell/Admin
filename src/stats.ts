import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js'
import path from 'path'
import { Pool } from 'pg'
import { pathToFileURL } from 'url'
import type {
  KuromojiBuilder,
  KuromojiTokenizer
} from 'kuromoji-ko'

export type Period = 'day' | 'week' | 'month' | 'all'
export type Scope = 'user' | 'guild'

export const PAGE_SIZE = 10
export const PARTICIPANT_PAGE_SIZE = 1

type StatsWordRow = {
  word: string
  count: number
}

type StatsPageResult = {
  totalMessages: number
  words: StatsWordRow[]
  totalCount: number
  hasNext: boolean
  participantCount?: number
}

type ParticipantPageResult = {
  userIds: string[]
  totalCount: number
  hasNext: boolean
}

let tokenizerPromise: Promise<KuromojiTokenizer | null> | null = null
let lastTokenizerInitFailedAt = 0
const TOKENIZER_RETRY_MS = 60_000
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

function isValidWord(word: string, pos: string) {
  if (!word) return false
  if (/^https?:\/\//i.test(word)) return false
  if (/^[0-9]+$/.test(word)) return false
  if (/^[^a-zA-Z0-9가-힣]+$/.test(word)) return false
  if (pos.startsWith('J') || pos.startsWith('E') || pos.startsWith('S'))
    return false
  return true
}

function getPeriodLabel(period: Period) {
  if (period === 'day') return '일'
  if (period === 'week') return '주'
  if (period === 'month') return '월'
  return '전체'
}

function fallbackTokenize(text: string) {
  return text
    .split(/[\s.,!?;:"'()[\]{}<>/\\|`~@#$%^&*+=_-]+/)
    .map(token => token.trim())
    .filter(token => token.length > 1)
    .map(token => token.toLowerCase())
}

function resolveKuromojiDicPath() {
  const toFileUrl = (targetPath: string) => {
    const normalizedPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(targetPath)
    const url = pathToFileURL(normalizedPath).toString()
    return url.endsWith('/') ? url : `${url}/`
  }

  const fromEnv = process.env.KUROMOJI_DICT_PATH?.trim()
  if (fromEnv) {
    if (/^https?:\/\//i.test(fromEnv) || fromEnv.startsWith('file://')) {
      return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`
    }
    return toFileUrl(fromEnv)
  }

  const candidatePaths: string[] = []
  try {
    const mainPath = require.resolve('kuromoji-ko')
    candidatePaths.push(path.join(path.dirname(mainPath), '..', 'dict'))
    candidatePaths.push(path.join(path.dirname(mainPath), 'dict'))
  } catch (error) {
    // try next fallback
  }

  try {
    const packageJsonPath = require.resolve('kuromoji-ko/package.json')
    candidatePaths.push(path.join(path.dirname(packageJsonPath), 'dict'))
  } catch (error) {
    // ignored
  }

  for (const candidatePath of candidatePaths) {
    if (candidatePath && require('fs').existsSync(candidatePath)) {
      return toFileUrl(candidatePath)
    }
  }

  return undefined
}

async function createKuromojiTokenizer(): Promise<KuromojiTokenizer | null> {
  try {
    const kuromoji = require('kuromoji-ko') as {
      builder(options?: { dicPath?: string }): KuromojiBuilder
    }
    if (!kuromoji?.builder) return null

    const dicPath = resolveKuromojiDicPath()
    const builder = kuromoji.builder(dicPath ? { dicPath } : undefined)

    return await new Promise((resolve, reject) => {
      builder.build((error, tokenizer) => {
        if (error) {
          reject(error)
          return
        }
        resolve(tokenizer)
      })
    })
  } catch (error) {
    console.warn('kuromoji-ko tokenizer init failed, fallback tokenization used.')
    return null
  }
}

async function getTokenizer() {
  const now = Date.now()
  if (
    tokenizerPromise === null &&
    lastTokenizerInitFailedAt > 0 &&
    now - lastTokenizerInitFailedAt < TOKENIZER_RETRY_MS
  ) {
    return null
  }

  if (!tokenizerPromise) {
    tokenizerPromise = createKuromojiTokenizer()
      .then(tokenizer => {
        if (!tokenizer) {
          lastTokenizerInitFailedAt = Date.now()
          tokenizerPromise = null
        } else {
          lastTokenizerInitFailedAt = 0
        }
        return tokenizer
      })
      .catch(error => {
        console.warn('kuromoji-ko tokenizer init failed, fallback tokenization used.')
        lastTokenizerInitFailedAt = Date.now()
        tokenizerPromise = null
        return null
      })
  }
  return tokenizerPromise
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

async function analyzeWords(text: string): Promise<string[]> {
  const tokenizer = await getTokenizer().catch(() => null)
  if (!tokenizer) return fallbackTokenize(text)

  try {
    const tokens = tokenizer.tokenize(text)
    const words: string[] = []

    for (const token of tokens) {
      const surface = token.surface_form?.trim()
      if (!surface) continue

      const pos = token.pos ?? ''
      if (!isValidWord(surface, pos)) continue
      words.push(surface.toLowerCase())
    }

    return words
  } catch (error) {
    console.warn('kuromoji-ko tokenize failed, fallback tokenization used.')
    return fallbackTokenize(text)
  }
}

export function makeCustomBase(
  ownerId: string,
  scope: Scope,
  period: Period,
  rank: number
) {
  return `stats:${ownerId}:${scope}:${period}:${rank}`
}

export function parseStatsCustomId(customId: string) {
  const parts = customId.split(':')
  if (parts.length !== 7) return null
  if (parts[0] !== 'stats') return null

  const [, ownerId, scope, period, rankStr, action, pageStr] = parts
  if (scope !== 'user' && scope !== 'guild') return null
  if (
    period !== 'day' &&
    period !== 'week' &&
    period !== 'month' &&
    period !== 'all'
  )
    return null
  if (action !== 'prev' && action !== 'next' && action !== 'open') return null

  const rank = Number(rankStr)
  const page = Number(pageStr)
  if (!Number.isFinite(rank) || !Number.isFinite(page)) return null
  if (!Number.isInteger(rank) || !Number.isInteger(page)) return null
  if (rank <= 0 || page < 0) return null

  return {
    ownerId,
    scope: scope as Scope,
    period: period as Period,
    rank,
    action: action as 'prev' | 'next' | 'open',
    page
  }
}

export function makeParticipantsCustomId(
  ownerId: string,
  period: Period,
  rank: number
) {
  return `participants:${ownerId}:${period}:${rank}`
}

export function parseParticipantsCustomId(customId: string) {
  const parts = customId.split(':')
  if (parts.length !== 6) return null
  if (parts[0] !== 'participants') return null

  const [, ownerId, period, rankStr, action, pageStr] = parts
  if (
    period !== 'day' &&
    period !== 'week' &&
    period !== 'month' &&
    period !== 'all'
  ) {
    return null
  }
  if (action !== 'prev' && action !== 'next' && action !== 'open') return null

  const rank = Number(rankStr)
  const page = Number(pageStr)
  if (!Number.isFinite(rank) || !Number.isFinite(page)) return null
  if (!Number.isInteger(rank) || !Number.isInteger(page)) return null
  if (rank <= 0 || page < 0) return null

  return {
    ownerId,
    period: period as Period,
    rank,
    action: action as 'prev' | 'next' | 'open',
    page
  }
}

export function buildStatsEmbed(args: {
  scope: Scope
  period: Period
  targetLabel: string
  totalMessages: number
  words: StatsWordRow[]
  page: number
  pageSize: number
  totalCount: number
  participantCount?: number
  memberName?: string
  joinedAt?: Date | null
  avatarUrl?: string | null
  guildName?: string
  guildCreatedAt?: Date | null
  guildIconUrl?: string | null
}) {
  const {
    scope,
    period,
    targetLabel,
    totalMessages,
    words,
    page,
    pageSize,
    totalCount,
    participantCount,
    memberName,
    joinedAt,
    avatarUrl,
    guildName,
    guildCreatedAt,
    guildIconUrl
  } = args

  const periodLabel = getPeriodLabel(period)

  const maxFieldLength = 1000
  const startRank = page * pageSize
  let wordField = ''
  let shown = 0

  for (let i = 0; i < words.length; i += 1) {
    const row = words[i]
    const line = `${startRank + i + 1}. ${row.word} (${row.count})`
    const nextLength = wordField.length + line.length + (wordField ? 1 : 0)
    if (nextLength > maxFieldLength) break
    wordField += wordField ? `\n${line}` : line
    shown += 1
  }

  if (!wordField) wordField = '(데이터 없음)'
  else if (shown < words.length || startRank + shown < totalCount) {
    const remaining = Math.max(totalCount - (startRank + shown), 0)
    if (remaining > 0) wordField += `\n...외 ${remaining}개`
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const embed = new EmbedBuilder()
    .setTitle(`통계 - ${scope === 'user' ? '개인' : '서버'}`)
    .setDescription(`${targetLabel} · 기간: ${periodLabel}`)
    .addFields({
      name: scope === 'user' ? '총 메시지 수' : '총 메시지 수(유저 합산)',
      value: `${totalMessages}`,
      inline: true
    })
    .setFooter({ text: `페이지 ${page + 1} / ${totalPages}` })

  if (scope === 'guild' && typeof participantCount === 'number') {
    embed.addFields({
      name: '참여 유저 수',
      value: `${participantCount}`,
      inline: true
    })
  }

  embed.addFields({ name: `단어 TOP ${totalCount}`, value: wordField })

  if (scope === 'user') {
    if (avatarUrl) embed.setThumbnail(avatarUrl)
    const joinedLabel = joinedAt
      ? joinedAt.toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
      : '알 수 없음'
    embed.addFields({
      name: '프로필',
      value: `${memberName ?? '알 수 없음'} · 가입일 ${joinedLabel}`,
      inline: false
    })
  } else if (scope === 'guild') {
    if (guildIconUrl) embed.setThumbnail(guildIconUrl)
    const createdLabel = guildCreatedAt
      ? guildCreatedAt.toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
      : '알 수 없음'
    embed.addFields({
      name: '서버 정보',
      value: `${guildName ?? '알 수 없음'} · 생성일 ${createdLabel}`,
      inline: false
    })
  }

  return embed
}

export function buildParticipantsEmbed(args: {
  period: Period
  guildName?: string
  totalCount: number
  page: number
  memberName?: string
  avatarUrl?: string | null
}) {
  const { period, guildName, totalCount, page, memberName, avatarUrl } = args
  const periodLabel = getPeriodLabel(period)

  const totalPages = Math.max(1, Math.ceil(totalCount / PARTICIPANT_PAGE_SIZE))
  const embed = new EmbedBuilder()
    .setTitle('통계 - 참여자')
    .setDescription(`${guildName ?? '서버'} · 기간: ${periodLabel}`)
    .addFields({
      name: '닉네임',
      value: memberName ?? '알 수 없음',
      inline: false
    })
    .setFooter({ text: `페이지 ${page + 1} / ${totalPages}` })

  if (avatarUrl) embed.setThumbnail(avatarUrl)
  return embed
}

export function buildParticipantsButtons(
  customBase: string,
  page: number,
  hasPrev: boolean,
  hasNext: boolean,
  statsCustomBase: string
) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customBase}:prev:${page}`)
      .setLabel('이전')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(`${customBase}:next:${page}`)
      .setLabel('다음')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext),
    new ButtonBuilder()
      .setCustomId(`${statsCustomBase}:open:0`)
      .setLabel('통계')
      .setStyle(ButtonStyle.Primary)
  )
}

export function buildStatsButtons(
  customBase: string,
  page: number,
  hasPrev: boolean,
  hasNext: boolean
) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customBase}:prev:${page}`)
      .setLabel('이전')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(`${customBase}:next:${page}`)
      .setLabel('다음')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext)
  )
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
  const messageCountRes = await pool.query(messageCountQuery, params)
  const totalMessages = messageCountRes.rows[0]?.count ?? 0

  let participantCount: number | undefined
  if (args.scope === 'guild') {
    const participantQuery = `
      SELECT COUNT(DISTINCT user_id)::int AS count
      FROM message_stats
      WHERE ${baseWhere}${timeClause}
    `
    const participantRes = await pool.query(participantQuery, params)
    participantCount = participantRes.rows[0]?.count ?? 0
  }

  const wordCountQuery = `
    SELECT COUNT(DISTINCT word)::int AS count
    FROM word_stats
    WHERE ${baseWhere}${timeClause}
  `
  const wordCountRes = await pool.query(wordCountQuery, params)
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

  const wordRes = await pool.query(wordQuery, [...params, limit, offset])
  const words = wordRes.rows as StatsWordRow[]
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
  const countRes = await pool.query(countQuery, params)
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
  const idsRes = await pool.query(idsQuery, [...params, limit, offset])
  const userIds = idsRes.rows.map((row: { user_id: string }) => row.user_id)
  const hasNext = offset + limit < totalCount

  return {
    userIds,
    totalCount,
    hasNext
  }
}
