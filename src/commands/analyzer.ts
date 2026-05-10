import {
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Message
} from 'discord.js'
import {
  PAGE_SIZE,
  PARTICIPANT_PAGE_SIZE,
  buildParticipantsButtons,
  buildParticipantsEmbed,
  buildStatsButtons,
  buildStatsEmbed,
  fetchParticipantsPage,
  fetchStatsPage,
  makeCustomBase,
  makeParticipantsCustomId,
  parseParticipantsCustomId,
  parseStatsCustomId,
  trackMessage,
  type Scope
} from '../stats'
import {
  getCommandOptions,
  getNextPage,
  safeCommandReply,
  safeReply,
  safeUpdate
} from '../utils'

type AnalyzerService = {
  handleParticipantsButton: (interaction: ButtonInteraction) => Promise<boolean>
  handleStatsButton: (interaction: ButtonInteraction) => Promise<boolean>
  handleStatsCommand: (
    interaction: ChatInputCommandInteraction
  ) => Promise<void>
  trackIncomingMessage: (message: Message) => Promise<void>
}

function isAlreadyHandledError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const code = (error as { code?: number }).code
  return code === 40060 || code === 10062
}

async function replyGuildOnly(
  interaction: ButtonInteraction | ChatInputCommandInteraction
) {
  await safeReply(interaction, {
    content: '서버에서만 사용할 수 있어요.',
    ephemeral: true
  })
}

async function replyGuildUnavailable(interaction: ButtonInteraction) {
  await safeReply(interaction, {
    content: '서버 정보를 가져올 수 없어요. 잠시 후 다시 시도해주세요.',
    ephemeral: true
  })
}

async function replyOwnerOnly(interaction: ButtonInteraction) {
  await safeReply(interaction, {
    content: '이 통계는 명령어를 실행한 사람만 조작할 수 있어요.',
    ephemeral: true
  })
}

export function createAnalyzerService(): AnalyzerService {
  return {
    async handleParticipantsButton(interaction: ButtonInteraction) {
      const parsed = parseParticipantsCustomId(interaction.customId)
      if (!parsed) return false

      const guildId = interaction.guildId
      if (!guildId) {
        await replyGuildOnly(interaction)
        return true
      }

      const guild = interaction.guild
      if (!guild) {
        await replyGuildUnavailable(interaction)
        return true
      }

      if (interaction.user.id !== parsed.ownerId) {
        await replyOwnerOnly(interaction)
        return true
      }

      const nextPage = getNextPage(parsed.action, parsed.page)
      const result = await fetchParticipantsPage({
        period: parsed.period,
        page: nextPage,
        pageSize: PARTICIPANT_PAGE_SIZE,
        guildId
      })

      const userId = result.userIds[0]
      const member = userId
        ? await guild.members.fetch(userId).catch(() => null)
        : null

      const embed = buildParticipantsEmbed({
        period: parsed.period,
        guildName: guild.name,
        totalCount: result.totalCount,
        page: nextPage,
        memberName: member?.displayName ?? '알 수 없음',
        avatarUrl: member?.displayAvatarURL() ?? null
      })

      const participantsBase = makeParticipantsCustomId(
        parsed.ownerId,
        parsed.period,
        parsed.rank
      )
      const statsBase = makeCustomBase(
        parsed.ownerId,
        'guild',
        parsed.period,
        parsed.rank
      )

      const row = buildParticipantsButtons(
        participantsBase,
        nextPage,
        nextPage > 0,
        result.hasNext,
        statsBase
      )

      await safeUpdate(interaction, { embeds: [embed], components: [row] })
      return true
    },

    async handleStatsButton(interaction: ButtonInteraction) {
      const parsed = parseStatsCustomId(interaction.customId)
      if (!parsed) return false

      const guildId = interaction.guildId
      if (!guildId) {
        await replyGuildOnly(interaction)
        return true
      }

      const guild = interaction.guild
      if (!guild) {
        await replyGuildUnavailable(interaction)
        return true
      }

      if (interaction.user.id !== parsed.ownerId) {
        await replyOwnerOnly(interaction)
        return true
      }

      const nextPage = getNextPage(parsed.action, parsed.page)
      const result = await fetchStatsPage({
        scope: parsed.scope,
        period: parsed.period,
        rank: parsed.rank,
        page: nextPage,
        pageSize: PAGE_SIZE,
        userId: interaction.user.id,
        guildId
      })

      const member =
        parsed.scope === 'user'
          ? await guild.members.fetch(interaction.user.id)
          : null

      const targetLabel =
        parsed.scope === 'user'
          ? `${member?.displayName ?? '알 수 없음'} (${interaction.user.id})`
          : guild.name

      const customBase = makeCustomBase(
        parsed.ownerId,
        parsed.scope,
        parsed.period,
        parsed.rank
      )

      const embed = buildStatsEmbed({
        scope: parsed.scope,
        period: parsed.period,
        targetLabel,
        totalMessages: result.totalMessages,
        words: result.words,
        page: nextPage,
        pageSize: PAGE_SIZE,
        totalCount: result.totalCount,
        participantCount: result.participantCount,
        memberName: member?.displayName ?? undefined,
        joinedAt: member?.joinedAt ?? undefined,
        avatarUrl: member?.displayAvatarURL() ?? undefined,
        guildName: guild.name,
        guildCreatedAt: guild.createdAt,
        guildIconUrl: guild.iconURL() ?? undefined
      })

      const row = buildStatsButtons(
        customBase,
        nextPage,
        nextPage > 0,
        result.hasNext
      )

      if (parsed.scope === 'guild') {
        const participantsBase = makeParticipantsCustomId(
          interaction.user.id,
          parsed.period,
          parsed.rank
        )
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`${participantsBase}:open:0`)
            .setLabel('참여자')
            .setStyle(ButtonStyle.Primary)
        )
      }

      await safeUpdate(interaction, { embeds: [embed], components: [row] })
      return true
    },

    async handleStatsCommand(interaction: ChatInputCommandInteraction) {
      const options = getCommandOptions(interaction)
      if (!interaction.guildId) {
        await replyGuildOnly(interaction)
        return
      }

      if (!process.env.DATABASE_URL) {
        await safeReply(interaction, {
          content: 'DATABASE_URL 설정이 필요해요.',
          ephemeral: true
        })
        return
      }

      if (!interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferReply()
        } catch (error) {
          if (!isAlreadyHandledError(error)) {
            throw error
          }
          return
        }
      }

      const targetUser = options.getUser('유저')
      const scope: Scope = targetUser ? 'user' : 'guild'
      const targetUserId = targetUser?.id ?? interaction.user.id

      const periodRaw = options.getString('기간')
      const period =
        periodRaw === 'day' ||
        periodRaw === 'week' ||
        periodRaw === 'month' ||
        periodRaw === 'all'
          ? periodRaw
          : 'month'

      const rankRaw = options.getInteger('순위') ?? 10
      const rank = Math.max(1, rankRaw)

      const customBase = makeCustomBase(
        interaction.user.id,
        scope,
        period,
        rank
      )
      const result = await fetchStatsPage({
        scope,
        period,
        rank,
        page: 0,
        pageSize: PAGE_SIZE,
        userId: targetUserId,
        guildId: interaction.guildId
      })

      const member =
        scope === 'user'
          ? await interaction.guild?.members.fetch(targetUserId)
          : null

      const guild = interaction.guild
      const targetLabel =
        scope === 'user'
          ? `${member?.displayName ?? '알 수 없음'} (${targetUserId})`
          : (guild?.name ?? '서버')

      const embed = buildStatsEmbed({
        scope,
        period,
        targetLabel,
        totalMessages: result.totalMessages,
        words: result.words,
        page: 0,
        pageSize: PAGE_SIZE,
        totalCount: result.totalCount,
        participantCount: result.participantCount,
        memberName: member?.displayName ?? undefined,
        joinedAt: member?.joinedAt ?? undefined,
        avatarUrl: member?.displayAvatarURL() ?? undefined,
        guildName: guild?.name ?? undefined,
        guildCreatedAt: guild?.createdAt ?? undefined,
        guildIconUrl: guild?.iconURL() ?? undefined
      })

      const row = buildStatsButtons(customBase, 0, false, result.hasNext)
      if (scope === 'guild') {
        const participantsBase = makeParticipantsCustomId(
          interaction.user.id,
          period,
          rank
        )
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`${participantsBase}:open:0`)
            .setLabel('참여자')
            .setStyle(ButtonStyle.Primary)
        )
      }

      await safeCommandReply(interaction, {
        embeds: [embed],
        components: [row]
      })
    },

    async trackIncomingMessage(message: Message) {
      if (!message.guild) return
      if (message.author.bot) return
      if (message.interaction) return
      if (message.webhookId) return
      if (!message.content?.trim()) return
      if (!process.env.DATABASE_URL) return

      try {
        await trackMessage({
          guildId: message.guild.id,
          userId: message.author.id,
          content: message.content
        })
      } catch (error) {
        console.error('Failed to track message:', error)
      }
    }
  }
}
