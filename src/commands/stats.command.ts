import { SlashCommandBuilder } from 'discord.js'

export const statsCommand = new SlashCommandBuilder()
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
  )
