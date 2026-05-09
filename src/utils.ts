/**
 * 공유 유틸리티 함수
 */

import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  CommandInteractionOptionResolver,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  ModalSubmitInteraction,
  Guild,
  PermissionFlagsBits
} from 'discord.js'
import { AUTO_DRAW_CONFIG } from './config'

type ReplyOptions = InteractionReplyOptions
type UpdateOptions = InteractionEditReplyOptions

export async function safeReply(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  options: ReplyOptions
) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options)
  }
  return interaction.reply(options)
}

export async function safeCommandReply(
  interaction: ChatInputCommandInteraction,
  options: ReplyOptions
) {
  if (interaction.deferred || interaction.replied) {
    const { ephemeral, ...rest } = options
    return interaction.editReply(rest as InteractionEditReplyOptions)
  }
  return interaction.reply(options)
}

export async function safeUpdate(
  interaction: ButtonInteraction,
  options: UpdateOptions
) {
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(options)
  }
  return interaction.update(options)
}

export function getCommandOptions(
  interaction: ChatInputCommandInteraction
): CommandInteractionOptionResolver {
  return interaction.options as CommandInteractionOptionResolver
}

export type GuildContextCheckResult = 'ok' | 'no-guild-id' | 'no-guild'

export function ensureGuildContext(interaction: {
  guildId: string | null
  guild: Guild | null
}): GuildContextCheckResult {
  if (!interaction.guildId) return 'no-guild-id'
  if (!interaction.guild) return 'no-guild'
  return 'ok'
}

export function hasAdministratorPermission(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
): boolean {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
    false
  )
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return floored <= 0 ? fallback : floored
}

export function normalizeNonNegativeInt(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return floored < 0 ? fallback : floored
}

export function getNextPage(
  action: 'prev' | 'next' | 'open',
  currentPage: number
): number {
  switch (action) {
    case 'prev':
      return Math.max(0, currentPage - 1)
    case 'next':
      return currentPage + 1
    case 'open':
      return 0
  }
}

export function buildCronExpression(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`
}

export function parseDailyTime(timeInput: string) {
  const normalized = timeInput.trim()
  const matched = AUTO_DRAW_CONFIG.TIME_REGEX.exec(normalized)
  if (!matched) return null
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  return { hour, minute, normalized }
}
