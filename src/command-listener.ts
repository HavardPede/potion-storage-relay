import pg from "pg"
import { registry } from "./registry.js"
import type { OutboundMessage } from "./types.js"
import { log } from "./log.js"

const RECONNECT_DELAY_MS = 5_000
const PG_NOTIFY_CHANNEL = "plugin_command"

interface CommandNotificationPayload {
  readonly id: string
  readonly userId: string
  readonly type: "JOIN_PARTY" | "LEAVE_PARTY" | "ROLE_CHANGE"
  readonly passphrase: string | null
  readonly partyId: string | null
  readonly reason: string | null
  readonly role: string | null
  readonly rsn: string | null
}

const isCommandPayload = (value: unknown): value is CommandNotificationPayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return typeof v.id === "string" && typeof v.userId === "string"
}

const routeCommand = (payload: CommandNotificationPayload): void => {
  const connections = registry.getByUserAndRsn(payload.userId, payload.rsn)
  const message: OutboundMessage = {
    type: "COMMAND",
    id: payload.id,
    command: payload.type,
    passphrase: payload.passphrase,
    partyId: payload.partyId,
    reason: payload.reason,
    role: payload.role,
  }
  const serialized = JSON.stringify(message)
  log.info(
    `[command] routing: userId=${payload.userId}, rsn=${payload.rsn}, targets=${connections.length}, commandId=${message.id}`
  )
  for (const ws of connections) {
    try {
      ws.send(serialized)
    } catch (err) {
      log.error("[command] send failed:", err)
    }
  }
}

const listen = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

  client.on("error", (err) => {
    log.error("[pg-listen] connection error:", err)
    scheduleReconnect()
  })

  client.on("notification", (msg) => {
    if (msg.channel !== PG_NOTIFY_CHANNEL || !msg.payload) return
    try {
      const parsed: unknown = JSON.parse(msg.payload)
      if (!isCommandPayload(parsed)) {
        log.error("[pg-listen] invalid notification payload:", parsed)
        return
      }
      routeCommand(parsed)
    } catch (err) {
      log.error("[pg-listen] failed to parse notification:", err)
    }
  })

  await client.connect()
  await client.query(`LISTEN ${PG_NOTIFY_CHANNEL}`)
  log.info(`[pg-listen] listening for ${PG_NOTIFY_CHANNEL} notifications`)
}

const scheduleReconnect = (): void => {
  log.info(`[pg-listen] reconnecting in ${RECONNECT_DELAY_MS}ms`)
  setTimeout(() => {
    listen().catch((err) => {
      log.error("[pg-listen] reconnect failed:", err)
      scheduleReconnect()
    })
  }, RECONNECT_DELAY_MS)
}

export const startCommandListener = (): void => {
  listen().catch((err) => {
    log.error("[pg-listen] initial connect failed:", err)
    scheduleReconnect()
  })
}
