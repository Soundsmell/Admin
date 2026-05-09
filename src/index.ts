import {
  ActionRowBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  CommandInteractionOptionResolver,
  GatewayIntentBits,
  Guild,
  Interaction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  ModalBuilder,
  ModalSubmitInteraction,
  TextBasedChannel,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js'
import dotenv from 'dotenv'
import cron from 'node-cron'
import express from 'express'
import { Pool } from 'pg'
import {
  buildStatsButtons,
  buildStatsEmbed,
  buildParticipantsButtons,
  buildParticipantsEmbed,
  fetchParticipantsPage,
  fetchStatsPage,
  makeCustomBase,
  makeParticipantsCustomId,
  parseParticipantsCustomId,
  parseStatsCustomId,
  trackMessage,
  PAGE_SIZE,
  PARTICIPANT_PAGE_SIZE
} from './stats'
import { DRAW_CONFIG, AUTO_DRAW_CONFIG, LABELS, getEnvironment } from './config'
import {
  safeReply,
  safeCommandReply,
  safeUpdate,
  getCommandOptions,
  ensureGuildContext,
  hasAdministratorPermission,
  formatTime,
  normalizePositiveInt,
  normalizeNonNegativeInt,
  getNextPage,
  buildCronExpression
} from './utils'

import { parseDailyTime } from './utils'

dotenv.config()

type ReplyPayload = InteractionReplyOptions
type UpdatePayload = InteractionEditReplyOptions

type AutoDrawConfig = {
  guildId: string
  channelId: string
  hour: number
  minute: number
}
type AutoDrawPanelState = {
  ownerId: string
  channelId: string
  hour: number
  minute: number
  enabled: boolean
}

const databaseUrl = process.env.DATABASE_URL
const settingsPool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined
})
const autoDrawTasks = new Map<string, cron.ScheduledTask>()

// Koyeb 등 PaaS 배포를 위한 가상 웹 서버 설정 (Port Binding)
const app = express()
const PORT = process.env.PORT || 8000

app.get('/', (req, res) => {
  res.send('Discord Bot is alive!')
})

app.listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`)
})

// 봇 클라이언트 초기화
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const commands = [
  new SlashCommandBuilder()
    .setName('추첨')
    .setDescription('즉시 랜덤 유저 2명을 추첨합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(option =>
      option
        .setName('인원')
        .setDescription('뽑을 인원 수')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    )
    .addUserOption(option =>
      option
        .setName('제한1')
        .setDescription('특정 유저만 추첨할 때 사용')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('제한2')
        .setDescription('특정 유저만 추첨할 때 사용')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('제한3')
        .setDescription('특정 유저만 추첨할 때 사용')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('제한4')
        .setDescription('특정 유저만 추첨할 때 사용')
        .setRequired(false)
    )
    .addUserOption(option =>
      option
        .setName('제한5')
        .setDescription('특정 유저만 추첨할 때 사용')
        .setRequired(false)
    ), // 관리자 권한 필요
  new SlashCommandBuilder()
    .setName('통계')
    .setDescription('메시지/단어 통계를 확인합니다')
    .addStringOption(option =>
      option
        .setName('대상')
        .setDescription('개인 또는 서버')
        .setRequired(true)
        .addChoices(
          { name: '개인', value: 'user' },
          { name: '서버', value: 'guild' }
        )
    )
    .addStringOption(option =>
      option
        .setName('기간')
        .setDescription('조회 범위')
        .setRequired(false)
        .addChoices(
          { name: '일', value: 'day' },
          { name: '주', value: 'week' },
          { name: '월', value: 'month' },
          { name: '전체', value: 'all' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('순위')
        .setDescription('표시할 순위 개수')
        .setRequired(false)
        .addChoices(
          { name: '10', value: 10 },
          { name: '30', value: 30 },
          { name: '50', value: 50 },
          { name: '100', value: 100 }
        )
    ),
  new SlashCommandBuilder()
    .setName('추첨설정')
    .setDescription('자동 추첨 ON/OFF, 채널, 시간을 설정합니다')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
]

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
    action: action as 'toggle' | 'setch' | 'time' | 'save' | 'cancel',
    state: {
      ownerId: parts[2],
      channelId: parts[3],
      hour,
      minute,
      enabled: parts[6] === '1'
    } as AutoDrawPanelState
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
  } as AutoDrawPanelState
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

async function ensureAutoDrawTable() {
  if (!databaseUrl) return
  await settingsPool.query(`
    CREATE TABLE IF NOT EXISTS auto_draw_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
      minute SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 59),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function getAllAutoDrawConfigs(): Promise<AutoDrawConfig[]> {
  if (!databaseUrl) return []
  const result = await settingsPool.query(
    `SELECT guild_id, channel_id, hour, minute FROM auto_draw_settings`
  )
  return result.rows.map(
    (row: {
      guild_id: string
      channel_id: string
      hour: number
      minute: number
    }) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      hour: row.hour,
      minute: row.minute
    })
  )
}

async function getAutoDrawConfigByGuildId(
  guildId: string
): Promise<AutoDrawConfig | null> {
  if (!databaseUrl) return null
  const result = await settingsPool.query(
    `SELECT guild_id, channel_id, hour, minute FROM auto_draw_settings WHERE guild_id = $1`,
    [guildId]
  )
  const row = result.rows[0] as
    | {
        guild_id: string
        channel_id: string
        hour: number
        minute: number
      }
    | undefined
  if (!row) return null
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    hour: row.hour,
    minute: row.minute
  }
}

async function upsertAutoDrawConfig(config: AutoDrawConfig) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.')
  }
  await settingsPool.query(
    `
      INSERT INTO auto_draw_settings (guild_id, channel_id, hour, minute, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (guild_id)
      DO UPDATE SET channel_id = EXCLUDED.channel_id,
                    hour = EXCLUDED.hour,
                    minute = EXCLUDED.minute,
                    updated_at = now()
    `,
    [config.guildId, config.channelId, config.hour, config.minute]
  )
}

async function deleteAutoDrawConfig(guildId: string) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.')
  }
  await settingsPool.query(
    `DELETE FROM auto_draw_settings WHERE guild_id = $1`,
    [guildId]
  )
}

function unscheduleAutoDraw(guildId: string) {
  const existing = autoDrawTasks.get(guildId)
  if (!existing) return
  existing.stop()
  autoDrawTasks.delete(guildId)
}

function scheduleAutoDraw(config: AutoDrawConfig) {
  unscheduleAutoDraw(config.guildId)
  const cronExpression = buildCronExpression(config.hour, config.minute)
  const task = cron.schedule(
    cronExpression,
    async () => {
      await runDailyTask(config.channelId, DRAW_CONFIG.DEFAULT_COUNT, [], true)
    },
    {
      scheduled: true,
      timezone: 'Asia/Seoul'
    }
  )
  autoDrawTasks.set(config.guildId, task)
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`)

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!)
  try {
    console.log('Refreshing application (/) commands.')
    if (client.user) {
      // 개발 중 즉시 반영을 위해 현재 들어가 있는 모든 서버(Guild)에 직접 등록합니다.
      const guilds = client.guilds.cache
      for (const [guildId, guild] of guilds) {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guildId),
          { body: commands.map(command => command.toJSON()) }
        )
        console.log(`Registered commands for guild: ${guild.name} (${guildId})`)
      }
    }
  } catch (error) {
    console.error(error)
  }

  try {
    await ensureAutoDrawTable()
    const configs = await getAllAutoDrawConfigs()
    if (configs.length === 0 && process.env.TARGET_CHANNEL_ID) {
      const defaultParsed = parseDailyTime(AUTO_DRAW_CONFIG.DEFAULT_TIME)!
      scheduleAutoDraw({
        guildId: `legacy:${process.env.TARGET_CHANNEL_ID}`,
        channelId: process.env.TARGET_CHANNEL_ID,
        hour: defaultParsed.hour,
        minute: defaultParsed.minute
      })
      console.log('Scheduled legacy auto draw from TARGET_CHANNEL_ID at 20:00.')
    } else {
      configs.forEach(scheduleAutoDraw)
      console.log(`Scheduled auto draw tasks: ${configs.length}`)
    }
  } catch (error) {
    console.error('Failed to initialize auto draw schedules:', error)
  }
})

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

async function handleParticipantsButton(interaction: ButtonInteraction) {
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
}

async function handleStatsButton(interaction: ButtonInteraction) {
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
    parsed.scope === 'user' ? `<@${interaction.user.id}>` : guild.name
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
    guildName: guild?.name ?? undefined,
    guildCreatedAt: guild?.createdAt ?? undefined,
    guildIconUrl: guild?.iconURL() ?? undefined
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
}

async function handleDrawCommand(interaction: ChatInputCommandInteraction) {
  const options = getCommandOptions(interaction)
  const drawCountRaw = options.getInteger('인원') ?? DRAW_CONFIG.DEFAULT_COUNT
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
  ].filter((user): user is NonNullable<typeof user> => Boolean(user))
  const restrictedIds = restrictedUsers.map(user => user.id)

  await safeReply(interaction, {
    content: '추첨을 시작합니다...',
    ephemeral: true
  })
  await runDailyTask(interaction.channelId, drawCount, restrictedIds)
}

async function handleStatsCommand(interaction: ChatInputCommandInteraction) {
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

  const scopeRaw = options.getString('대상', true)
  if (scopeRaw !== 'user' && scopeRaw !== 'guild') {
    await safeReply(interaction, {
      content: '잘못된 대상 값이에요. 다시 시도해주세요.',
      ephemeral: true
    })
    return
  }

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
  const scope = scopeRaw

  // DB 조회/통계 생성이 3초를 넘길 수 있어 먼저 ACK 합니다.
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply()
    } catch (error) {
      if (!isAlreadyAcknowledgedError(error)) {
        throw error
      }
    }
  }

  const customBase = makeCustomBase(interaction.user.id, scope, period, rank)
  const result = await fetchStatsPage({
    scope,
    period,
    rank,
    page: 0,
    pageSize: PAGE_SIZE,
    userId: interaction.user.id,
    guildId: interaction.guildId
  })

  const member =
    scope === 'user'
      ? await interaction.guild?.members.fetch(interaction.user.id)
      : null
  const guild = interaction.guild
  const targetLabel =
    scope === 'user' ? `<@${interaction.user.id}>` : (guild?.name ?? '서버')
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

  await safeCommandReply(interaction, { embeds: [embed], components: [row] })
}

async function handleAutoDrawSetupCommand(
  interaction: ChatInputCommandInteraction
) {
  if (!hasAdministratorPermission(interaction)) {
    await replyAdminOnly(interaction)
    return
  }

  const guildContext = ensureGuildContext(interaction)
  if (guildContext === 'no-guild-id' || guildContext === 'no-guild') {
    await replyGuildOnly(interaction)
    return
  }
  if (!databaseUrl) {
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
  const existingConfig = await getAutoDrawConfigByGuildId(interaction.guildId!)
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
}

function isAlreadyAcknowledgedError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 40060
  )
}

async function handleUnexpectedInteractionError(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | ModalSubmitInteraction,
  error: unknown
) {
  console.error('interactionCreate failed:', error)
  try {
    if (
      interaction.deferred ||
      interaction.replied ||
      isAlreadyAcknowledgedError(error)
    ) {
      return
    }

    if (interaction.isModalSubmit()) {
      await interaction.reply({
        content: '처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
        ephemeral: true
      })
    } else {
      await safeReply(interaction, {
        content: '처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
        ephemeral: true
      })
    }
  } catch (replyError) {
    console.error('Failed to send error reply:', replyError)
  }
}

async function handleAutoDrawPanelButton(interaction: ButtonInteraction) {
  const parsed = parseAutoDrawState(interaction.customId)
  if (!parsed) return false

  const guildContext = ensureGuildContext(interaction)
  if (guildContext === 'no-guild-id' || guildContext === 'no-guild') {
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
  if (!databaseUrl) {
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
    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input)
    modal.addComponents(row)
    await interaction.showModal(modal)
    return true
  }

  if (parsed.action === 'save') {
    if (parsed.state.enabled) {
      const config: AutoDrawConfig = {
        guildId: interaction.guildId!,
        channelId: parsed.state.channelId,
        hour: parsed.state.hour,
        minute: parsed.state.minute
      }
      await upsertAutoDrawConfig(config)
      scheduleAutoDraw(config)
    } else {
      await deleteAutoDrawConfig(interaction.guildId!)
      unscheduleAutoDraw(interaction.guildId!)
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
}

async function handleAutoDrawTimeModal(interaction: ModalSubmitInteraction) {
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

client.on('interactionCreate', async (interaction: Interaction) => {
  if (
    !interaction.isButton() &&
    !interaction.isChatInputCommand() &&
    !interaction.isModalSubmit()
  ) {
    return
  }

  try {
    if (interaction.isButton()) {
      const handledAutoDrawPanel = await handleAutoDrawPanelButton(interaction)
      if (handledAutoDrawPanel) return

      const handledParticipants = await handleParticipantsButton(interaction)
      if (handledParticipants) return

      const handledStats = await handleStatsButton(interaction)
      if (handledStats) return
    }

    if (interaction.isModalSubmit()) {
      const handledAutoDrawTime = await handleAutoDrawTimeModal(interaction)
      if (handledAutoDrawTime) return
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === '추첨') {
        await handleDrawCommand(interaction)
        return
      }
      if (interaction.commandName === '통계') {
        await handleStatsCommand(interaction)
        return
      }
      if (interaction.commandName === '추첨설정') {
        await handleAutoDrawSetupCommand(interaction)
        return
      }
    }
  } catch (error) {
    await handleUnexpectedInteractionError(interaction, error)
  }
})

client.on('messageCreate', async message => {
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
})

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
      console.error(`Channel with ID ${channelId} is not a guild text channel.`)
      return
    }

    const guild = channel.guild
    // 모든 멤버 가져오기
    await guild.members.fetch()

    const restrictedSet = new Set(restrictedUserIds)

    // 봇, 서버장, 블랙리스트 유저를 제외한 멤버 필터링
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

    // 랜덤하게 지정한 인원 뽑기
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

    // 당일 요일 구하기
    const dayNames = ['일', '월', '화', '수', '목', '금', '토']
    const today = new Date()
    const dayName = dayNames[today.getDay()] // 0=일, 1=월, ..., 6=토

    // 메시지 출력
    const bonusLabel = bonusTriggered
      ? `피의 ${dayName}요일, 3명의 독재자 추가 `
      : ''
    const messageContent = `오늘의 독재자 명단: ${winners.map(w => w.toString()).join(', ')}${bonusLabel}`

    await channel.send(messageContent)
  } catch (error) {
    console.error('Error in daily task:', error)
  }
}

client.login(process.env.DISCORD_TOKEN)
