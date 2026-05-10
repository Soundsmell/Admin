import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'

export const autoDrawSetupCommand = new SlashCommandBuilder()
  .setName('추첨설정')
  .setDescription('자동 추첨 ON/OFF, 채널, 시간을 설정합니다')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
