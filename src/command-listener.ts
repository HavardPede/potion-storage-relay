import { registry } from "./registry.js"
import type { OutboundMessage } from "./types.js"
import { startPgListener } from "./pg-listen.js"
import { log } from "./log.js"

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

export const routeCommand = (payload: CommandNotificationPayload): void => {
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

const handleNotification = (channel: string, payload: string): void => {
  if (channel !== PG_NOTIFY_CHANNEL) return
  try {
    const parsed: unknown = JSON.parse(payload)
    if (!isCommandPayload(parsed)) {
      log.error("[command] invalid notification payload:", parsed)
      return
    }
    routeCommand(parsed)
  } catch (err) {
    log.error("[command] failed to parse notification:", err)
  }
}

export const startCommandListener = (): void => {
  startPgListener([PG_NOTIFY_CHANNEL], handleNotification)
}
