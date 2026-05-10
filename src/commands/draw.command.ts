import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'

export const drawCommand = new SlashCommandBuilder()
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
  )
