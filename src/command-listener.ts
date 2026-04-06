import pg from "pg"
import { registry } from "./registry.js"
import type { OutboundMessage } from "./types.js"

const RECONNECT_DELAY_MS = 5_000

const routeCommand = (row: Record<string, unknown>): void => {
  const userId = row.userId as string
  const rsn = (row.rsn as string) ?? null
  const connections = registry.getByUserAndRsn(userId, rsn)

  const message: OutboundMessage = {
    type: "COMMAND",
    id: row.id as string,
    command: row.type as "JOIN_PARTY" | "LEAVE_PARTY",
    passphrase: (row.passphrase as string) ?? null,
    partyId: (row.partyId as string) ?? null,
    reason: (row.reason as string) ?? null,
  }

  const serialized = JSON.stringify(message)
  console.log(
    `[command] routing: userId=${userId}, rsn=${rsn}, targets=${connections.length}, commandId=${message.id}`
  )
  for (const ws of connections) {
    try {
      ws.send(serialized)
    } catch (err) {
      console.error("[command] send failed:", err)
    }
  }
}

const listen = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

  client.on("error", (err) => {
    console.error("[pg-listen] connection error:", err)
    scheduleReconnect()
  })

  client.on("notification", (msg) => {
    if (msg.channel !== "plugin_command" || !msg.payload) return
    try {
      const row = JSON.parse(msg.payload) as Record<string, unknown>
      routeCommand(row)
    } catch (err) {
      console.error("[pg-listen] failed to parse notification:", err)
    }
  })

  await client.connect()
  await client.query("LISTEN plugin_command")
  console.log("[pg-listen] listening for plugin_command notifications")
}

const scheduleReconnect = (): void => {
  console.log(`[pg-listen] reconnecting in ${RECONNECT_DELAY_MS}ms`)
  setTimeout(() => {
    listen().catch((err) => {
      console.error("[pg-listen] reconnect failed:", err)
      scheduleReconnect()
    })
  }, RECONNECT_DELAY_MS)
}

export const startCommandListener = (): void => {
  listen().catch((err) => {
    console.error("[pg-listen] initial connect failed:", err)
    scheduleReconnect()
  })
}
