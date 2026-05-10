import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  ModalSubmitInteraction,
  REST,
  Routes
} from 'discord.js'
import { createAnalyzerService } from '@/commands/analyzer'
import { createDrawService } from '@/commands/draw'
import { autoDrawRepository } from '@/stats/repository'
import { autoDrawSetupCommand } from '@/commands/autodraw.command'
import { drawCommand } from '@/commands/draw.command'
import { statsCommand } from '@/commands/stats.command'
import { safeReply } from '@/utils'

const commands = [drawCommand, statsCommand, autoDrawSetupCommand]

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
  const repository = autoDrawRepository
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
