import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  ModalBuilder,
  ModalSubmitInteraction,
  TextBasedChannel,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js'
import cron from 'node-cron'
import { AUTO_DRAW_CONFIG, DRAW_CONFIG } from '@/config'
import {
  buildCronExpression,
  ensureGuildContext,
  formatTime,
  getCommandOptions,
  hasAdministratorPermission,
  parseDailyTime,
  safeReply,
  safeUpdate
} from '@/utils'
import type { AutoDrawConfig, AutoDrawRepository } from '@/stats/repository'

type AutoDrawPanelState = {
  ownerId: string
  channelId: string
  hour: number
  minute: number
  enabled: boolean
}

type DrawService = {
  initializeAutoDrawSchedules: () => Promise<void>
  handleDrawCommand: (interaction: ChatInputCommandInteraction) => Promise<void>
  handleAutoDrawSetupCommand: (
    interaction: ChatInputCommandInteraction
  ) => Promise<void>
  handleAutoDrawPanelButton: (
    interaction: ButtonInteraction
  ) => Promise<boolean>
  handleAutoDrawTimeModal: (
    interaction: ModalSubmitInteraction
  ) => Promise<boolean>
}

function buildAutoDrawSetupSuccessEmbed(args: {
  channelId: string
  hour: number
  minute: number
  bonusChance: number
  bonusExtraCount: number
  enabled: boolean
}) {
  const { channelId, hour, minute, bonusChance, bonusExtraCount, enabled } =
    args
  const chanceLabel = `${Math.round(bonusChance * 100)}%`
  const timeLabel = formatTime(hour, minute)

  return {
    color: 0x7c3aed,
    title: '⏰ 추첨 설정 저장 완료',
    description: '자동 추첨 설정이 업데이트되었어요.',
    fields: [
      {
        name: '상태',
        value: enabled ? 'ON (활성화)' : 'OFF (비활성화)',
        inline: true
      },
      {
        name: '채널',
        value: `<#${channelId}>`,
        inline: true
      },
      {
        name: '시간',
        value: `${timeLabel} (KST)`,
        inline: true
      },
      {
        name: '보너스 이벤트',
        value: `${chanceLabel} 확률로 +${bonusExtraCount}명 추가 당첨`,
        inline: false
      },
      {
        name: '안내',
        value: '변경하려면 `/추첨설정`을 다시 실행하세요.',
        inline: false
      }
    ],
    footer: {
      text: 'Daily Admin Bot'
    }
  }
}

function buildAutoDrawPanelEmbed(state: AutoDrawPanelState) {
  return {
    color: 0x7c3aed,
    title: '⚙️ 추첨 설정 패널',
    description: '1) 상태/채널/시간을 설정하고 2) 저장을 누르세요.',
    fields: [
      {
        name: '상태',
        value: state.enabled ? 'ON (활성화)' : 'OFF (비활성화)',
        inline: true
      },
      {
        name: '채널',
        value: `<#${state.channelId}>`,
        inline: true
      },
      {
        name: '시간',
        value: `${formatTime(state.hour, state.minute)} (KST)`,
        inline: true
      },
      {
        name: '보너스 이벤트',
        value: `${Math.round(DRAW_CONFIG.BONUS_CHANCE * 100)}% 확률로 +${DRAW_CONFIG.BONUS_EXTRA_COUNT}명`,
        inline: false
      }
    ],
    footer: {
      text: '설정은 저장 버튼을 눌러야 적용됩니다.'
    }
  }
}

function encodeAutoDrawState(
  action: 'toggle' | 'setch' | 'time' | 'save' | 'cancel',
  state: AutoDrawPanelState
) {
  return `autodraw:${action}:${state.ownerId}:${state.channelId}:${state.hour}:${state.minute}:${state.enabled ? 1 : 0}`
}

function parseAutoDrawState(customId: string) {
  const parts = customId.split(':')
  if (parts.length !== 7) return null
  if (parts[0] !== 'autodraw') return null

  const action = parts[1]
  if (
    action !== 'toggle' &&
    action !== 'setch' &&
    action !== 'time' &&
    action !== 'save' &&
    action !== 'cancel'
  ) {
    return null
  }

  const hour = Number(parts[4])
  const minute = Number(parts[5])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  if (parts[6] !== '0' && parts[6] !== '1') return null

  return {
    action,
    state: {
      ownerId: parts[2],
      channelId: parts[3],
      hour,
      minute,
      enabled: parts[6] === '1'
    } satisfies AutoDrawPanelState
  }
}

function makeAutoDrawTimeModalCustomId(state: AutoDrawPanelState) {
  return `autodrawm:${state.ownerId}:${state.channelId}:${state.hour}:${state.minute}:${state.enabled ? 1 : 0}`
}

function parseAutoDrawTimeModalCustomId(customId: string) {
  const parts = customId.split(':')
  if (parts.length !== 6) return null
  if (parts[0] !== 'autodrawm') return null

  const hour = Number(parts[3])
  const minute = Number(parts[4])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  if (parts[5] !== '0' && parts[5] !== '1') return null

  return {
    ownerId: parts[1],
    channelId: parts[2],
    hour,
    minute,
    enabled: parts[5] === '1'
  } satisfies AutoDrawPanelState
}

function buildAutoDrawPanelButtons(state: AutoDrawPanelState) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeAutoDrawState('toggle', state))
      .setLabel(state.enabled ? '상태: ON -> OFF' : '상태: OFF -> ON')
      .setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeAutoDrawState('setch', state))
      .setLabel('채널: 현재 채널로')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeAutoDrawState('time', state))
      .setLabel('시간 변경')
      .setStyle(ButtonStyle.Secondary)
  )

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeAutoDrawState('save', state))
      .setLabel('저장')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeAutoDrawState('cancel', state))
      .setLabel('취소')
      .setStyle(ButtonStyle.Danger)
  )

  return [row1, row2]
}

export function createDrawService(args: {
  client: Client
  repository: AutoDrawRepository
}): DrawService {
  const { client, repository } = args
  const autoDrawTasks = new Map<string, cron.ScheduledTask>()

  function unscheduleAutoDraw(guildId: string) {
    const existing = autoDrawTasks.get(guildId)
    if (!existing) return
    existing.stop()
    autoDrawTasks.delete(guildId)
  }

  async function runDailyTask(
    targetChannelId?: string,
    drawCount: number = DRAW_CONFIG.DEFAULT_COUNT,
    restrictedUserIds: string[] = [],
    isScheduledRun = false
  ) {
    const channelId = targetChannelId || process.env.TARGET_CHANNEL_ID

    if (!channelId) {
      console.error('TARGET_CHANNEL_ID is not set in .env')
      return
    }

    try {
      const fetchedChannel = await client.channels.fetch(channelId)
      const channel =
        fetchedChannel && fetchedChannel.isTextBased()
          ? (fetchedChannel as TextBasedChannel)
          : null

      if (!channel) {
        console.error(`Channel with ID ${channelId} not found.`)
        return
      }

      if (!('guild' in channel) || !channel.guild) {
        console.error(
          `Channel with ID ${channelId} is not a guild text channel.`
        )
        return
      }

      const guild = channel.guild
      await guild.members.fetch()

      const restrictedSet = new Set(restrictedUserIds)
      let candidates = guild.members.cache.filter(
        member =>
          !member.user.bot &&
          member.id !== guild.ownerId &&
          !DRAW_CONFIG.BLACKLIST_USER_IDS.has(member.id)
      )

      if (restrictedSet.size > 0) {
        candidates = candidates.filter(member => restrictedSet.has(member.id))
      }

      const bonusTriggered =
        isScheduledRun && Math.random() < DRAW_CONFIG.BONUS_CHANCE
      const totalDrawCount = bonusTriggered
        ? drawCount + DRAW_CONFIG.BONUS_EXTRA_COUNT
        : drawCount

      if (candidates.size < totalDrawCount) {
        await channel.send(
          `추첨을 진행하기에 멤버(봇/서버장 제외)가 충분하지 않습니다. (최소 ${totalDrawCount}명 필요)`
        )
        return
      }

      const randomResult = candidates.random(totalDrawCount)
      const winners = Array.isArray(randomResult)
        ? randomResult
        : randomResult
          ? [randomResult]
          : []

      if (winners.length < totalDrawCount) {
        await channel.send(
          '추첨 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.'
        )
        return
      }

      const dayNames = ['일', '월', '화', '수', '목', '금', '토'] as const
      const dayName = dayNames[new Date().getDay()]
      const bonusLabel = bonusTriggered
        ? `피의 ${dayName}요일, 3명의 독재자 추가 `
        : ''
      const messageContent = `오늘의 독재자 명단: ${winners.map(winner => winner.toString()).join(', ')}${bonusLabel}`

      await channel.send(messageContent)
    } catch (error) {
      console.error('Error in daily task:', error)
    }
  }

  function scheduleAutoDraw(config: AutoDrawConfig) {
    unscheduleAutoDraw(config.guildId)
    const cronExpression = buildCronExpression(config.hour, config.minute)

    const task = cron.schedule(
      cronExpression,
      async () => {
        await runDailyTask(
          config.channelId,
          DRAW_CONFIG.DEFAULT_COUNT,
          [],
          true
        )
      },
      {
        scheduled: true,
        timezone: 'Asia/Seoul'
      }
    )

    autoDrawTasks.set(config.guildId, task)
  }

  async function replyGuildOnly(
    interaction: ButtonInteraction | ChatInputCommandInteraction
  ) {
    await safeReply(interaction, {
      content: '서버에서만 사용할 수 있어요.',
      ephemeral: true
    })
  }

  async function replyAdminOnly(
    interaction:
      | ButtonInteraction
      | ChatInputCommandInteraction
      | ModalSubmitInteraction
  ) {
    if (interaction.isModalSubmit()) {
      await interaction.reply({
        content: '이 기능은 관리자만 사용할 수 있어요.',
        ephemeral: true
      })
      return
    }

    await safeReply(interaction, {
      content: '이 기능은 관리자만 사용할 수 있어요.',
      ephemeral: true
    })
  }

  return {
    async initializeAutoDrawSchedules() {
      if (!repository.isConfigured()) return

      try {
        await repository.ensureTable()
        const configs = await repository.getAllConfigs()

        if (configs.length === 0 && process.env.TARGET_CHANNEL_ID) {
          const defaultParsed = parseDailyTime(AUTO_DRAW_CONFIG.DEFAULT_TIME)
          if (!defaultParsed) return

          scheduleAutoDraw({
            guildId: `legacy:${process.env.TARGET_CHANNEL_ID}`,
            channelId: process.env.TARGET_CHANNEL_ID,
            hour: defaultParsed.hour,
            minute: defaultParsed.minute
          })
          console.log('Scheduled legacy auto draw from TARGET_CHANNEL_ID.')
          return
        }

        configs.forEach(scheduleAutoDraw)
        console.log(`Scheduled auto draw tasks: ${configs.length}`)
      } catch (error) {
        console.error('Failed to initialize auto draw schedules:', error)
      }
    },

    async handleDrawCommand(interaction: ChatInputCommandInteraction) {
      const options = getCommandOptions(interaction)
      const drawCountRaw =
        options.getInteger('인원') ?? DRAW_CONFIG.DEFAULT_COUNT
      const drawCount = Math.min(
        DRAW_CONFIG.MAX_COUNT,
        Math.max(DRAW_CONFIG.MIN_COUNT, drawCountRaw)
      )

      const restrictedUsers = [
        options.getUser('제한1'),
        options.getUser('제한2'),
        options.getUser('제한3'),
        options.getUser('제한4'),
        options.getUser('제한5')
      ].filter((user): user is NonNullable<typeof user> => user !== null)

      await safeReply(interaction, {
        content: '추첨을 시작합니다...',
        ephemeral: true
      })

      await runDailyTask(
        interaction.channelId,
        drawCount,
        restrictedUsers.map(user => user.id)
      )
    },

    async handleAutoDrawSetupCommand(interaction: ChatInputCommandInteraction) {
      if (!hasAdministratorPermission(interaction)) {
        await replyAdminOnly(interaction)
        return
      }

      const guildContext = ensureGuildContext(interaction)
      if (guildContext === 'no-guild-id' || guildContext === 'no-guild') {
        await replyGuildOnly(interaction)
        return
      }
      const guildId = interaction.guildId
      if (!guildId) {
        await replyGuildOnly(interaction)
        return
      }

      if (!repository.isConfigured()) {
        await safeReply(interaction, {
          content: '자동 추첨 설정에는 DATABASE_URL이 필요해요.',
          ephemeral: true
        })
        return
      }

      const defaultParsed = parseDailyTime(AUTO_DRAW_CONFIG.DEFAULT_TIME)
      if (!defaultParsed) {
        await safeReply(interaction, {
          content: '기본 시간 설정을 읽지 못했어요.',
          ephemeral: true
        })
        return
      }

      const existingConfig = await repository.getConfigByGuildId(guildId)
      const state: AutoDrawPanelState = {
        ownerId: interaction.user.id,
        channelId: existingConfig?.channelId ?? interaction.channelId,
        hour: existingConfig?.hour ?? defaultParsed.hour,
        minute: existingConfig?.minute ?? defaultParsed.minute,
        enabled: Boolean(existingConfig)
      }

      await safeReply(interaction, {
        embeds: [buildAutoDrawPanelEmbed(state)],
        components: buildAutoDrawPanelButtons(state),
        ephemeral: true
      })
    },

    async handleAutoDrawPanelButton(interaction: ButtonInteraction) {
      const parsed = parseAutoDrawState(interaction.customId)
      if (!parsed) return false

      const guildContext = ensureGuildContext(interaction)
      if (guildContext === 'no-guild-id' || guildContext === 'no-guild') {
        await replyGuildOnly(interaction)
        return true
      }
      const guildId = interaction.guildId
      if (!guildId) {
        await replyGuildOnly(interaction)
        return true
      }

      if (interaction.user.id !== parsed.state.ownerId) {
        await safeReply(interaction, {
          content: '이 설정 패널은 명령어를 실행한 사람만 사용할 수 있어요.',
          ephemeral: true
        })
        return true
      }

      if (!hasAdministratorPermission(interaction)) {
        await replyAdminOnly(interaction)
        return true
      }

      if (!repository.isConfigured()) {
        await safeReply(interaction, {
          content: '자동 추첨 설정에는 DATABASE_URL이 필요해요.',
          ephemeral: true
        })
        return true
      }

      if (parsed.action === 'cancel') {
        await safeUpdate(interaction, {
          content: '자동 추첨 설정을 취소했어요.',
          embeds: [],
          components: []
        })
        return true
      }

      if (parsed.action === 'toggle') {
        const nextState: AutoDrawPanelState = {
          ...parsed.state,
          enabled: !parsed.state.enabled
        }
        await safeUpdate(interaction, {
          embeds: [buildAutoDrawPanelEmbed(nextState)],
          components: buildAutoDrawPanelButtons(nextState)
        })
        return true
      }

      if (parsed.action === 'setch') {
        const channel = interaction.channel
        if (!channel || !('id' in channel)) {
          await safeReply(interaction, {
            content: '현재 채널 정보를 읽을 수 없어요.',
            ephemeral: true
          })
          return true
        }

        const nextState: AutoDrawPanelState = {
          ...parsed.state,
          channelId: channel.id
        }

        await safeUpdate(interaction, {
          embeds: [buildAutoDrawPanelEmbed(nextState)],
          components: buildAutoDrawPanelButtons(nextState)
        })
        return true
      }

      if (parsed.action === 'time') {
        const modal = new ModalBuilder()
          .setCustomId(makeAutoDrawTimeModalCustomId(parsed.state))
          .setTitle('자동 추첨 시간 설정')

        const input = new TextInputBuilder()
          .setCustomId('time_input')
          .setLabel('시간 (HH:MM, 24시간)')
          .setPlaceholder('20:00')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(formatTime(parsed.state.hour, parsed.state.minute))

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
          input
        )
        modal.addComponents(row)

        await interaction.showModal(modal)
        return true
      }

      if (parsed.action === 'save') {
        if (parsed.state.enabled) {
          const config: AutoDrawConfig = {
            guildId,
            channelId: parsed.state.channelId,
            hour: parsed.state.hour,
            minute: parsed.state.minute
          }
          await repository.upsertConfig(config)
          scheduleAutoDraw(config)
        } else {
          await repository.deleteConfig(guildId)
          unscheduleAutoDraw(guildId)
        }

        await safeUpdate(interaction, {
          embeds: [
            buildAutoDrawSetupSuccessEmbed({
              channelId: parsed.state.channelId,
              hour: parsed.state.hour,
              minute: parsed.state.minute,
              bonusChance: DRAW_CONFIG.BONUS_CHANCE,
              bonusExtraCount: DRAW_CONFIG.BONUS_EXTRA_COUNT,
              enabled: parsed.state.enabled
            })
          ],
          components: []
        })
        return true
      }

      return true
    },

    async handleAutoDrawTimeModal(interaction: ModalSubmitInteraction) {
      const parsed = parseAutoDrawTimeModalCustomId(interaction.customId)
      if (!parsed) return false

      if (interaction.user.id !== parsed.ownerId) {
        await interaction.reply({
          content: '이 설정 패널은 명령어를 실행한 사람만 사용할 수 있어요.',
          ephemeral: true
        })
        return true
      }

      if (!hasAdministratorPermission(interaction)) {
        await replyAdminOnly(interaction)
        return true
      }

      const timeInput = interaction.fields.getTextInputValue('time_input')
      const time = parseDailyTime(timeInput)
      if (!time) {
        await interaction.reply({
          content: '시간 형식이 올바르지 않아요. 예: 20:00',
          ephemeral: true
        })
        return true
      }

      const nextState: AutoDrawPanelState = {
        ...parsed,
        hour: time.hour,
        minute: time.minute
      }

      await interaction.reply({
        embeds: [buildAutoDrawPanelEmbed(nextState)],
        components: buildAutoDrawPanelButtons(nextState),
        ephemeral: true
      })
      return true
    }
  }
}
