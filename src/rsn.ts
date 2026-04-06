import type { PoolClient } from "pg"
import { pool } from "./db.js"
import { PartyStatus, ApplicationStatus } from "./types.js"

const RSN_SOURCE_PLUGIN = "PLUGIN"

interface RsnRow {
  readonly id: string
  readonly userId: string
  readonly source: string
}

interface AcceptedPartyRow {
  readonly partyId: string
}

export const displaceAndRegisterRsn = async (userId: string, rsn: string): Promise<void> => {
  const rsnLower = rsn.toLowerCase()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const existing = await client.query<RsnRow>(
      `SELECT id, "userId", source FROM "Rsn" WHERE rsn_lower = $1`,
      [rsnLower]
    )

    if (existing.rows.length > 0) {
      const row = existing.rows[0]
      if (row.userId === userId) {
        if (row.source !== RSN_SOURCE_PLUGIN) await updateRsnSource(client, row.id)
        await client.query("COMMIT")
        return
      }
      await cleanupDisplacedOwner(client, row.id, row.userId)
    }

    await upsertRsn(client, userId, rsn, rsnLower)
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

const cleanupDisplacedOwner = async (
  client: PoolClient,
  rsnId: string,
  displacedUserId: string
): Promise<void> => {
  console.warn(`[rsn] displaced: rsnId=${rsnId}, fromUserId=${displacedUserId}`)

  await client.query(
    `UPDATE "Application" SET status = $2 WHERE "rsnId" = $1 AND status = $3`,
    [rsnId, ApplicationStatus.Withdrawn, ApplicationStatus.Pending]
  )

  const accepted = await client.query<AcceptedPartyRow>(
    `SELECT a."partyId" FROM "Application" a
     JOIN "Party" p ON p.id = a."partyId"
     WHERE a."rsnId" = $1 AND a.status = $2 AND p.status = $3`,
    [rsnId, ApplicationStatus.Accepted, PartyStatus.Open]
  )

  for (const row of accepted.rows) {
    await client.query(
      `DELETE FROM "PartyMember" WHERE "partyId" = $1 AND "userId" = $2`,
      [row.partyId, displacedUserId]
    )
  }

  await client.query(
    `UPDATE "User" SET "defaultRsnId" = NULL WHERE id = $1 AND "defaultRsnId" = $2`,
    [displacedUserId, rsnId]
  )
}

const updateRsnSource = async (client: PoolClient, rsnId: string): Promise<void> => {
  await client.query(`UPDATE "Rsn" SET source = $1 WHERE id = $2`, [RSN_SOURCE_PLUGIN, rsnId])
}

const upsertRsn = async (
  client: PoolClient,
  userId: string,
  rsn: string,
  rsnLower: string
): Promise<void> => {
  await client.query(
    `INSERT INTO "Rsn" (id, "userId", rsn, rsn_lower, source, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
     ON CONFLICT (rsn_lower) DO UPDATE SET "userId" = $1, rsn = $2, source = $4`,
    [userId, rsn, rsnLower, RSN_SOURCE_PLUGIN]
  )
}
