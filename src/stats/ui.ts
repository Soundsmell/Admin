import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js'
import {
  PAGE_SIZE,
  PARTICIPANT_PAGE_SIZE,
  type Period,
  type Scope,
  type StatsWordRow
} from './types'

function getPeriodLabel(period: Period) {
  if (period === 'day') return '일'
  if (period === 'week') return '주'
  if (period === 'month') return '월'
  return '전체'
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
  } else {
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
