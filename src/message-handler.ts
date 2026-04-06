import type { WebSocket } from "ws"
import { parseInbound, type OutboundMessage } from "./types.js"
import { registry } from "./registry.js"
import { writePresenceOnline, writePresenceOffline } from "./presence.js"
import { displaceAndRegisterRsn } from "./rsn.js"
import { pool } from "./db.js"
import {
  PARTY_STATUS_OPEN,
  APPLICATION_STATUS_ACCEPTED,
  APPLICATION_STATUS_WITHDRAWN,
} from "./db-enums.js"

interface PendingCommandRow {
  readonly id: string
  readonly type: "JOIN_PARTY" | "LEAVE_PARTY"
  readonly passphrase: string | null
  readonly partyId: string | null
  readonly reason: string | null
}

const sendJson = (ws: WebSocket, message: OutboundMessage): void => {
  ws.send(JSON.stringify(message))
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

const handleIdentify = async (ws: WebSocket, userId: string, rsn: string): Promise<void> => {
  console.log(`[identify] userId=${userId}, rsn=${rsn}`)
  registry.updateRsn(ws, rsn)
  await displaceAndRegisterRsn(userId, rsn)
  await writePresenceOnline(userId, rsn)
  await deliverPendingCommands(ws, userId, rsn)
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
         AND p.status = $2
       LIMIT 1
     ),
     updated_app AS (
       UPDATE "Application"
       SET status = $3
       WHERE "userId" = $1
         AND "partyId" IN (SELECT "partyId" FROM matched_member)
         AND status = $4
     )
     DELETE FROM "PartyMember"
     WHERE "userId" = $1
       AND "partyId" IN (SELECT "partyId" FROM matched_member)`,
    [userId, PARTY_STATUS_OPEN, APPLICATION_STATUS_WITHDRAWN, APPLICATION_STATUS_ACCEPTED]
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

const deliverPendingCommands = async (ws: WebSocket, userId: string, rsn: string): Promise<void> => {
  const result = await pool.query<PendingCommandRow>(
    `SELECT id, type, passphrase, "partyId", reason
     FROM "PluginCommand"
     WHERE "userId" = $1 AND "ackedAt" IS NULL AND "expiresAt" > NOW()
     AND (rsn = $2 OR rsn IS NULL)
     ORDER BY "createdAt" ASC`,
    [userId, rsn]
  )
  for (const row of result.rows) {
    sendJson(ws, {
      type: "COMMAND",
      id: row.id,
      command: row.type,
      passphrase: row.passphrase,
      partyId: row.partyId,
      reason: row.reason,
    })
  }
}
