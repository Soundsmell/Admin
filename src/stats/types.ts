export type Period = 'day' | 'week' | 'month' | 'all'
export type Scope = 'user' | 'guild'

export const PAGE_SIZE = 10
export const PARTICIPANT_PAGE_SIZE = 1

export type StatsWordRow = {
  word: string
  count: number
}

export type StatsPageResult = {
  totalMessages: number
  words: StatsWordRow[]
  totalCount: number
  hasNext: boolean
  participantCount?: number
}

export type ParticipantPageResult = {
  userIds: string[]
  totalCount: number
  hasNext: boolean
}
