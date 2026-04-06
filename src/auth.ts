import { createHash, randomBytes } from "crypto"
import type { PoolClient } from "pg"
import { pool } from "./db.js"

const HASH_ALGORITHM = "sha256"

const DEVICE_NAME_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
}

export interface IssuedToken {
  readonly userId: string
  readonly token: string
}

interface PairingCodeRow {
  readonly id: string
  readonly userId: string
}

interface PluginTokenRow {
  readonly userId: string
}

const hashToken = (plaintext: string): string =>
  createHash(HASH_ALGORITHM).update(plaintext).digest("hex")

const generateBearerToken = (): string => randomBytes(32).toString("hex")

export const validateToken = async (rawToken: string): Promise<string | null> => {
  const tokenHash = hashToken(rawToken)
  const result = await pool.query<PluginTokenRow>(
    'SELECT "userId" FROM "PluginToken" WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
    [tokenHash]
  )
  if (result.rows.length === 0) return null
  return result.rows[0].userId
}

export const issueTokenFromPairingCode = async (code: string): Promise<IssuedToken | null> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const row = await lookupPairingCode(client, code)
    if (!row) return null

    const plainToken = generateBearerToken()
    const deviceName = `RuneLite Device (${new Date().toLocaleDateString("en-US", DEVICE_NAME_DATE_OPTIONS)})`
    await insertPluginToken(client, row.userId, hashToken(plainToken), deviceName, row.id)
    await client.query("COMMIT")
    return { userId: row.userId, token: plainToken }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

const lookupPairingCode = async (client: PoolClient, code: string): Promise<PairingCodeRow | null> => {
  const result = await client.query<PairingCodeRow>(
    `SELECT id, "userId" FROM "PairingCode"
     WHERE code = $1 AND "usedAt" IS NULL AND "expiresAt" > NOW()`,
    [code]
  )
  if (result.rows.length === 0) {
    await client.query("ROLLBACK")
    return null
  }
  return result.rows[0]
}

const insertPluginToken = async (
  client: PoolClient,
  userId: string,
  tokenHash: string,
  deviceName: string,
  codeId: string
): Promise<void> => {
  await client.query(
    `INSERT INTO "PluginToken" (id, "userId", "tokenHash", "deviceName", "createdAt")
     VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    [userId, tokenHash, deviceName]
  )
  await client.query(
    `UPDATE "PairingCode" SET "usedAt" = NOW() WHERE id = $1`,
    [codeId]
  )
}
