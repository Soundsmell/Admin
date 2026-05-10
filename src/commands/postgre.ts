import { Pool } from 'pg'

export type AutoDrawConfig = {
  guildId: string
  channelId: string
  hour: number
  minute: number
}

type AutoDrawRow = {
  guild_id: string
  channel_id: string
  hour: number
  minute: number
}

export type AutoDrawRepository = {
  isConfigured: () => boolean
  ensureTable: () => Promise<void>
  getAllConfigs: () => Promise<AutoDrawConfig[]>
  getConfigByGuildId: (guildId: string) => Promise<AutoDrawConfig | null>
  upsertConfig: (config: AutoDrawConfig) => Promise<void>
  deleteConfig: (guildId: string) => Promise<void>
}

export function createAutoDrawRepository(
  databaseUrl: string | undefined
): AutoDrawRepository {
  const pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : undefined
      })
    : null

  function assertPool(): Pool {
    if (!pool) {
      throw new Error('DATABASE_URL is not set.')
    }
    return pool
  }

  return {
    isConfigured() {
      return Boolean(pool)
    },

    async ensureTable() {
      if (!pool) return
      await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_draw_settings (
          guild_id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
          minute SMALLINT NOT NULL CHECK (minute BETWEEN 0 AND 59),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
    },

    async getAllConfigs() {
      if (!pool) return []
      const result = await pool.query<AutoDrawRow>(
        'SELECT guild_id, channel_id, hour, minute FROM auto_draw_settings'
      )
      return result.rows.map(row => ({
        guildId: row.guild_id,
        channelId: row.channel_id,
        hour: row.hour,
        minute: row.minute
      }))
    },

    async getConfigByGuildId(guildId: string) {
      if (!pool) return null
      const result = await pool.query<AutoDrawRow>(
        'SELECT guild_id, channel_id, hour, minute FROM auto_draw_settings WHERE guild_id = $1',
        [guildId]
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        guildId: row.guild_id,
        channelId: row.channel_id,
        hour: row.hour,
        minute: row.minute
      }
    },

    async upsertConfig(config: AutoDrawConfig) {
      const db = assertPool()
      await db.query(
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
    },

    async deleteConfig(guildId: string) {
      const db = assertPool()
      await db.query('DELETE FROM auto_draw_settings WHERE guild_id = $1', [
        guildId
      ])
    }
  }
}
