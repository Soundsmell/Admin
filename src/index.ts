import {
  Client,
  GatewayIntentBits,
  TextChannel,
  GuildMember,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js'
import dotenv from 'dotenv'
import cron from 'node-cron'
import express from 'express'
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

dotenv.config()

async function safeReply(
  interaction: { replied: boolean; deferred: boolean; reply: Function; followUp: Function },
  options: Record<string, unknown>
) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options)
  }
  return interaction.reply(options)
}

async function safeUpdate(
  interaction: { replied: boolean; deferred: boolean; update: Function; editReply: Function },
  options: Record<string, unknown>
) {
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(options)
  }
  return interaction.update(options)
}

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
    )
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
  if (interaction.isButton()) {
    const participantsParsed = parseParticipantsCustomId(interaction.customId)
    if (participantsParsed) {
      if (!interaction.guildId) {
        await safeReply(interaction, {
          content: '서버에서만 사용할 수 있어요.',
          ephemeral: true
        })
        return
      }

      if (!interaction.guild) {
        await safeReply(interaction, {
          content: '서버 정보를 가져올 수 없어요. 잠시 후 다시 시도해주세요.',
          ephemeral: true
        })
        return
      }

      if (interaction.user.id !== participantsParsed.ownerId) {
        await safeReply(interaction, {
          content: '이 통계는 명령어를 실행한 사람만 조작할 수 있어요.',
          ephemeral: true
        })
        return
      }

      const nextPage =
        participantsParsed.action === 'next'
          ? participantsParsed.page + 1
          : participantsParsed.action === 'prev'
            ? Math.max(participantsParsed.page - 1, 0)
            : participantsParsed.page

      const result = await fetchParticipantsPage({
        period: participantsParsed.period,
        page: nextPage,
        pageSize: PARTICIPANT_PAGE_SIZE,
        guildId: interaction.guildId
      })

      const userId = result.userIds[0]
      const member = userId
        ? await interaction.guild.members.fetch(userId).catch(() => null)
        : null
      const embed = buildParticipantsEmbed({
        period: participantsParsed.period,
        guildName: interaction.guild?.name,
        totalCount: result.totalCount,
        page: nextPage,
        memberName: member?.displayName ?? '알 수 없음',
        avatarUrl: member?.displayAvatarURL() ?? null
      })

      const participantsBase = makeParticipantsCustomId(
        participantsParsed.ownerId,
        participantsParsed.period,
        participantsParsed.rank
      )
      const statsBase = makeCustomBase(
        participantsParsed.ownerId,
        'guild',
        participantsParsed.period,
        participantsParsed.rank
      )
      const row = buildParticipantsButtons(
        participantsBase,
        nextPage,
        nextPage > 0,
        result.hasNext,
        statsBase
      )

      await safeUpdate(interaction, { embeds: [embed], components: [row] })
      return
    }
  }

  if (interaction.isButton()) {
    const parsed = parseStatsCustomId(interaction.customId)
    if (!parsed) return

    if (!interaction.guildId) {
      await safeReply(interaction, {
        content: '서버에서만 사용할 수 있어요.',
        ephemeral: true
      })
      return
    }

    if (interaction.user.id !== parsed.ownerId) {
      await safeReply(interaction, {
        content: '이 통계는 명령어를 실행한 사람만 조작할 수 있어요.',
        ephemeral: true
      })
      return
    }

    const nextPage =
      parsed.action === 'next'
        ? parsed.page + 1
        : parsed.action === 'prev'
          ? Math.max(parsed.page - 1, 0)
          : parsed.page
    const result = await fetchStatsPage({
      scope: parsed.scope,
      period: parsed.period,
      rank: parsed.rank,
      page: nextPage,
      pageSize: PAGE_SIZE,
      userId: interaction.user.id,
      guildId: interaction.guildId
    })

    if (!interaction.guild) {
      await safeReply(interaction, {
        content: '서버 정보를 가져올 수 없어요. 잠시 후 다시 시도해주세요.',
        ephemeral: true
      })
      return
    }

    const member =
      parsed.scope === 'user'
        ? await interaction.guild.members.fetch(interaction.user.id)
        : null
    const guild = interaction.guild
    const targetLabel =
      parsed.scope === 'user'
        ? `<@${interaction.user.id}>`
        : (guild?.name ?? '서버')
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
    return
  }

  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === '추첨') {
    const drawCount = interaction.options.getInteger('인원') ?? 2
    const restrictedUsers = [
      interaction.options.getUser('제한1'),
      interaction.options.getUser('제한2'),
      interaction.options.getUser('제한3'),
      interaction.options.getUser('제한4'),
      interaction.options.getUser('제한5')
    ].filter(Boolean)
    const restrictedIds = restrictedUsers.map(user => user!.id)

    await safeReply(interaction, {
      content: '추첨을 시작합니다...',
      ephemeral: true
    })
    await runDailyTask(interaction.channelId, drawCount, restrictedIds)
  }

  if (interaction.commandName === '통계') {
    if (!interaction.guildId) {
      await safeReply(interaction, {
        content: '서버에서만 사용할 수 있어요.',
        ephemeral: true
      })
      return
    }

    if (!process.env.DATABASE_URL) {
      await safeReply(interaction, {
        content: 'DATABASE_URL 설정이 필요해요.',
        ephemeral: true
      })
      return
    }

    const scope = interaction.options.getString('대상', true) as
      | 'user'
      | 'guild'
    const period =
      (interaction.options.getString('기간') as
        | 'day'
        | 'week'
        | 'month'
        | 'all') ?? 'month'
    const rank = interaction.options.getInteger('순위') ?? 10

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

    await safeReply(interaction, { embeds: [embed], components: [row] })
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
  drawCount = 2,
  restrictedUserIds: string[] = []
) {
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

    const restrictedSet = new Set(restrictedUserIds)

    // 봇과 서버장을 제외한 멤버 필터링
    let candidates = guild.members.cache.filter(
      member => !member.user.bot && member.id !== guild.ownerId
    )

    if (restrictedSet.size > 0) {
      candidates = candidates.filter(member => restrictedSet.has(member.id))
    }

    if (candidates.size < drawCount) {
      await channel.send(
        `추첨을 진행하기에 멤버(봇/서버장 제외)가 충분하지 않습니다. (최소 ${drawCount}명 필요)`
      )
      return
    }

    // 랜덤하게 지정한 인원 뽑기
    const winners = candidates.random(drawCount) as GuildMember[]

    // 메시지 출력
    const messageContent = `오늘의 독재자 명단: ${winners.map(w => w.toString()).join(', ')}`

    await channel.send(messageContent)
  } catch (error) {
    console.error('Error in daily task:', error)
  }
}

client.login(process.env.DISCORD_TOKEN)
