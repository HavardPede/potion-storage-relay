import pg from "pg"
import { log } from "./log.js"

export type NotificationHandler = (channel: string, payload: string) => void

const RECONNECT_DELAY_MS = 5_000
const KEEPALIVE_INTERVAL_MS = 30_000

let activeClient: pg.Client | null = null
let keepaliveTimer: ReturnType<typeof setInterval> | null = null
let channels: string[] = []
let handler: NotificationHandler | null = null

const cleanup = (): void => {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }
  if (activeClient) {
    activeClient.removeAllListeners()
    activeClient.end().catch(() => {})
    activeClient = null
  }
}

const connect = async (): Promise<void> => {
  cleanup()

  const connectionString = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL
  const client = new pg.Client({ connectionString })
  activeClient = client

  client.on("error", (err) => {
    log.error("[pg-listen] connection error:", err)
    cleanup()
    scheduleReconnect()
  })

  client.on("notification", (msg) => {
    if (!msg.payload || !handler) return
    handler(msg.channel, msg.payload)
  })

  await client.connect()

  for (const channel of channels) {
    await client.query(`LISTEN ${channel}`)
  }

  log.info(`[pg-listen] listening on channels: ${channels.join(", ")}`)

  keepaliveTimer = setInterval(() => {
    client.query("SELECT 1").catch((err) => {
      log.error("[pg-listen] keepalive failed:", err)
      cleanup()
      scheduleReconnect()
    })
  }, KEEPALIVE_INTERVAL_MS)
}

const scheduleReconnect = (): void => {
  log.info(`[pg-listen] reconnecting in ${RECONNECT_DELAY_MS}ms`)
  setTimeout(() => {
    connect().catch((err) => {
      log.error("[pg-listen] reconnect failed:", err)
      scheduleReconnect()
    })
  }, RECONNECT_DELAY_MS)
}

export const startPgListener = (
  listenChannels: string[],
  onNotification: NotificationHandler
): void => {
  channels = listenChannels
  handler = onNotification
  connect().catch((err) => {
    log.error("[pg-listen] initial connect failed:", err)
    scheduleReconnect()
  })
}
