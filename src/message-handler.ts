import type { WebSocket } from "ws"
import { parseInbound, type OutboundMessage } from "./types.js"
import { registry } from "./registry.js"
import { writePresenceOnline, writePresenceOffline } from "./presence.js"
import { displaceAndRegisterRsn } from "./rsn.js"
import { pool } from "./db.js"

const sendJson = (ws: WebSocket, message: OutboundMessage): void => {
  ws.send(JSON.stringify(message))
}

const handleIdentify = async (ws: WebSocket, userId: string, rsn: string): Promise<void> => {
  console.log(`[identify] userId=${userId}, rsn=${rsn}`)
  registry.updateRsn(ws, rsn)
  await displaceAndRegisterRsn(userId, rsn)
  await writePresenceOnline(userId, rsn)

  const pending = await pool.query(
    `SELECT id, type, passphrase, "partyId", reason
     FROM "PluginCommand"
     WHERE "userId" = $1 AND "ackedAt" IS NULL AND "expiresAt" > NOW()
     AND (rsn = $2 OR rsn IS NULL)
     ORDER BY "createdAt" ASC`,
    [userId, rsn]
  )

  for (const row of pending.rows) {
    const typed = row as Record<string, unknown>
    sendJson(ws, {
      type: "COMMAND",
      id: typed.id as string,
      command: typed.type as "JOIN_PARTY" | "LEAVE_PARTY",
      passphrase: (typed.passphrase as string) ?? null,
      partyId: (typed.partyId as string) ?? null,
      reason: (typed.reason as string) ?? null,
    })
  }
}

const handleAck = async (userId: string, commandId: string): Promise<void> => {
  await pool.query(
    `UPDATE "PluginCommand" SET "ackedAt" = NOW() WHERE id = $1 AND "userId" = $2`,
    [commandId, userId]
  )
}

const handlePartyStateLeft = async (userId: string): Promise<void> => {
  await pool.query(
    `WITH matched_member AS (
       SELECT pm."partyId"
       FROM "PartyMember" pm
       JOIN "Party" p ON p.id = pm."partyId"
       WHERE pm."userId" = $1
         AND p.status = 'OPEN'
       LIMIT 1
     ),
     updated_app AS (
       UPDATE "Application"
       SET status = 'WITHDRAWN'
       WHERE "userId" = $1
         AND "partyId" IN (SELECT "partyId" FROM matched_member)
         AND status = 'ACCEPTED'
     )
     DELETE FROM "PartyMember"
     WHERE "userId" = $1
       AND "partyId" IN (SELECT "partyId" FROM matched_member)`,
    [userId]
  )
}

const handlePresence = async (
  ws: WebSocket,
  userId: string,
  status: "online" | "offline"
): Promise<void> => {
  const conn = registry.getConnectionByWs(ws)
  if (!conn?.rsn) return

  if (status === "online") {
    await writePresenceOnline(userId, conn.rsn)
  } else {
    await writePresenceOffline(userId, conn.rsn)
  }
}

export const handleMessage = async (
  ws: WebSocket,
  userId: string,
  data: string
): Promise<void> => {
  const msg = parseInbound(data)
  if (!msg) {
    sendJson(ws, { type: "ERROR", message: "Invalid message format" })
    return
  }

  switch (msg.type) {
    case "IDENTIFY":
      await handleIdentify(ws, userId, msg.rsn)
      break
    case "ACK":
      await handleAck(userId, msg.commandId)
      break
    case "PARTY_STATE":
      if (msg.state === "LEFT") await handlePartyStateLeft(userId)
      break
    case "PRESENCE":
      await handlePresence(ws, userId, msg.status)
      break
    default:
      break
  }
}
