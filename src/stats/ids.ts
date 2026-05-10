import type { Period, Scope } from './types'

type StatsAction = 'prev' | 'next' | 'open'

export type ParsedStatsCustomId = {
  ownerId: string
  scope: Scope
  period: Period
  rank: number
  action: StatsAction
  page: number
}

export type ParsedParticipantsCustomId = {
  ownerId: string
  period: Period
  rank: number
  action: StatsAction
  page: number
}

function isScope(value: string): value is Scope {
  return value === 'user' || value === 'guild'
}

function isPeriod(value: string): value is Period {
  return (
    value === 'day' || value === 'week' || value === 'month' || value === 'all'
  )
}

function isStatsAction(value: string): value is StatsAction {
  return value === 'prev' || value === 'next' || value === 'open'
}

export function makeCustomBase(
  ownerId: string,
  scope: Scope,
  period: Period,
  rank: number
) {
  return `stats:${ownerId}:${scope}:${period}:${rank}`
}

export function parseStatsCustomId(
  customId: string
): ParsedStatsCustomId | null {
  const parts = customId.split(':')
  if (parts.length !== 7) return null
  if (parts[0] !== 'stats') return null

  const [, ownerId, scope, period, rankStr, action, pageStr] = parts
  if (!isScope(scope)) return null
  if (!isPeriod(period)) return null
  if (!isStatsAction(action)) return null

  const rank = Number(rankStr)
  const page = Number(pageStr)
  if (!Number.isFinite(rank) || !Number.isFinite(page)) return null
  if (!Number.isInteger(rank) || !Number.isInteger(page)) return null
  if (rank <= 0 || page < 0) return null

  return {
    ownerId,
    scope,
    period,
    rank,
    action,
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

export function parseParticipantsCustomId(
  customId: string
): ParsedParticipantsCustomId | null {
  const parts = customId.split(':')
  if (parts.length !== 6) return null
  if (parts[0] !== 'participants') return null

  const [, ownerId, period, rankStr, action, pageStr] = parts
  if (!isPeriod(period)) return null
  if (!isStatsAction(action)) return null

  const rank = Number(rankStr)
  const page = Number(pageStr)
  if (!Number.isFinite(rank) || !Number.isFinite(page)) return null
  if (!Number.isInteger(rank) || !Number.isInteger(page)) return null
  if (rank <= 0 || page < 0) return null

  return {
    ownerId,
    period,
    rank,
    action,
    page
  }
}
