import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js'
import { createAnalyzerService } from './commands/analyzer'
import { createDrawService } from './commands/draw'
import { createAutoDrawRepository } from './commands/postgre'
import { safeReply } from './utils'

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
    ),
  new SlashCommandBuilder()
    .setName('통계')
    .setDescription('메시지/단어 통계를 확인합니다')
    .addUserOption(option =>
      option
        .setName('유저')
        .setDescription('특정 유저의 통계를 보려면 선택 (없으면 서버 통계)')
        .setRequired(false)
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

function isAlreadyHandledError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const code = (error as { code?: number }).code
  return code === 40060 || code === 10062
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
      isAlreadyHandledError(error)
    ) {
      return
    }

    if (interaction.isModalSubmit()) {
      await interaction.reply({
        content: '처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
        ephemeral: true
      })
      return
    }

    await safeReply(interaction, {
      content: '처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
      ephemeral: true
    })
  } catch (replyError) {
    console.error('Failed to send error reply:', replyError)
  }
}

async function registerSlashCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN
  if (!token || !client.user) return

  const rest = new REST({ version: '10' }).setToken(token)
  const guilds = client.guilds.cache

  for (const [guildId, guild] of guilds) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
      body: commands.map(command => command.toJSON())
    })
    console.log(`Registered commands for guild: ${guild.name} (${guildId})`)
  }
}

export function registerBotHandlers(client: Client) {
  const repository = createAutoDrawRepository(process.env.DATABASE_URL)
  const drawService = createDrawService({ client, repository })
  const analyzerService = createAnalyzerService()

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user?.tag ?? 'unknown user'}!`)

    try {
      console.log('Refreshing application (/) commands.')
      await registerSlashCommands(client)
    } catch (error) {
      console.error('Failed to register slash commands:', error)
    }

    await drawService.initializeAutoDrawSchedules()
  })

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
        if (await drawService.handleAutoDrawPanelButton(interaction)) return
        if (await analyzerService.handleParticipantsButton(interaction)) return
        if (await analyzerService.handleStatsButton(interaction)) return
      }

      if (interaction.isModalSubmit()) {
        if (await drawService.handleAutoDrawTimeModal(interaction)) return
      }

      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === '추첨') {
          await drawService.handleDrawCommand(interaction)
          return
        }
        if (interaction.commandName === '통계') {
          await analyzerService.handleStatsCommand(interaction)
          return
        }
        if (interaction.commandName === '추첨설정') {
          await drawService.handleAutoDrawSetupCommand(interaction)
          return
        }
      }
    } catch (error) {
      await handleUnexpectedInteractionError(interaction, error)
    }
  })

  client.on('messageCreate', async message => {
    await analyzerService.trackIncomingMessage(message)
  })
}
