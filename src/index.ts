import {
  Client,
  GatewayIntentBits,
  TextChannel,
  GuildMember,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js'
import dotenv from 'dotenv'
import cron from 'node-cron'
import express from 'express'

dotenv.config()

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
    .setName('draw')
    .setDescription('즉시 랜덤 유저 3명을 추첨합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // 관리자 권한 필요
]

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

  cron.schedule(
    '0 20 * * *',
    async () => {
      console.log('Running daily task...')
      await runDailyTask()
    },
    {
      scheduled: true,
      timezone: 'Asia/Seoul'
    }
  )
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === 'draw') {
    await interaction.reply({
      content: '추첨을 시작합니다...',
      ephemeral: true
    })
    await runDailyTask(interaction.channelId)
  }
})

async function runDailyTask(targetChannelId?: string) {
  const channelId = targetChannelId || process.env.TARGET_CHANNEL_ID

  if (!channelId) {
    console.error('TARGET_CHANNEL_ID is not set in .env')
    return
  }

  try {
    const channel = (await client.channels.fetch(channelId)) as TextChannel
    if (!channel) {
      console.error(`Channel with ID ${channelId} not found.`)
      return
    }

    const guild = channel.guild
    // 모든 멤버 가져오기
    await guild.members.fetch()

    // 봇과 서버장을 제외한 멤버 필터링
    const candidates = guild.members.cache.filter(
      member => !member.user.bot && member.id !== guild.ownerId
    )

    if (candidates.size < 3) {
      await channel.send(
        '추첨을 진행하기에 멤버(봇/서버장 제외)가 충분하지 않습니다 (최소 3명 필요).'
      )
      return
    }

    // 랜덤하게 3명 뽑기
    const winners = candidates.random(3) as GuildMember[]

    // 메시지 출력
    const messageContent = `오늘의 독재자 명단: ${winners.map(w => w.toString()).join(', ')}`

    await channel.send(messageContent)
  } catch (error) {
    console.error('Error in daily task:', error)
  }
}

client.login(process.env.DISCORD_TOKEN)
