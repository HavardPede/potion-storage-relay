import type { WebSocket } from "ws"
import { parseInbound, type OutboundMessage, PartyStatus, ApplicationStatus } from "./types.js"
import { registry } from "./registry.js"
import { writePresenceOnline, writePresenceOffline } from "./presence.js"
import { displaceAndRegisterRsn } from "./rsn.js"
import { pool } from "./db.js"
import { log } from "./log.js"

interface PendingCommandRow {
  readonly id: string
  readonly type: "JOIN_PARTY" | "LEAVE_PARTY" | "ROLE_CHANGE"
  readonly passphrase: string | null
  readonly partyId: string | null
  readonly reason: string | null
  readonly role: string | null
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
      log.debug(`[party-state] userId=${userId}, state=${msg.state}`)
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
  log.info(`[identify] userId=${userId}, rsn=${rsn}`)
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
  log.debug(`[party-state] leaving party for userId=${userId}`)
  const party = await findOpenPartyForUser(userId)
  if (!party) {
    log.debug(`[party-state] no open party found for userId=${userId}`)
    return
  }
  if (party.isLeader) {
    await closeParty(party.partyId)
    log.debug(`[party-state] closed party=${party.partyId} (leader left)`)
  } else {
    await removeMember(userId, party.partyId)
    log.debug(`[party-state] removed member userId=${userId} from party=${party.partyId}`)
  }
}

interface UserParty {
  readonly partyId: string
  readonly isLeader: boolean
}

const findOpenPartyForUser = async (userId: string): Promise<UserParty | null> => {
  const result = await pool.query<{ partyId: string; isLeader: boolean }>(
    `SELECT pm."partyId", (p."userId" = $1) AS "isLeader"
     FROM "PartyMember" pm
     JOIN "Party" p ON p.id = pm."partyId"
     WHERE pm."userId" = $1 AND p.status = $2
     LIMIT 1`,
    [userId, PartyStatus.Open]
  )
  return result.rows[0] ?? null
}

const closeParty = async (partyId: string): Promise<void> => {
  await pool.query(
    `WITH close_party AS (
       UPDATE "Party" SET status = $2 WHERE id = $1 AND status = $3
     ),
     withdraw_apps AS (
       UPDATE "Application" SET status = $4
       WHERE "partyId" = $1 AND status IN ($5, $6)
     )
     DELETE FROM "PartyMember" WHERE "partyId" = $1`,
    [
      partyId,
      PartyStatus.Closed,
      PartyStatus.Open,
      ApplicationStatus.Withdrawn,
      ApplicationStatus.Pending,
      ApplicationStatus.Accepted,
    ]
  )
}

const removeMember = async (userId: string, partyId: string): Promise<void> => {
  await pool.query(
    `WITH updated_app AS (
       UPDATE "Application" SET status = $3
       WHERE "userId" = $1 AND "partyId" = $2 AND status = $4
     )
     DELETE FROM "PartyMember"
     WHERE "userId" = $1 AND "partyId" = $2`,
    [userId, partyId, ApplicationStatus.Withdrawn, ApplicationStatus.Accepted]
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
    `SELECT id, type, passphrase, "partyId", reason, role
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
      role: row.role,
    })
  }
}
