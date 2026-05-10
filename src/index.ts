import { Client, GatewayIntentBits } from 'discord.js'
import dotenv from 'dotenv'
import express from 'express'
import { registerBotHandlers } from './commands'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8000)

app.get('/', (_req, res) => {
  res.send('Discord Bot is alive!')
})

app.listen(port, () => {
  console.log(`Web server is listening on port ${port}`)
})

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

registerBotHandlers(client)

const token = process.env.DISCORD_TOKEN
if (!token) {
  throw new Error('DISCORD_TOKEN is not set in environment variables.')
}

client.login(token)
