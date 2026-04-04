import { createHash, randomBytes } from "crypto"
import { pool } from "./db.js"

const HASH_ALGORITHM = "sha256"

const DEVICE_NAME_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
}

const hashToken = (plaintext: string): string =>
  createHash(HASH_ALGORITHM).update(plaintext).digest("hex")

const generateBearerToken = (): string => randomBytes(32).toString("hex")

export const validateToken = async (rawToken: string): Promise<string | null> => {
  const tokenHash = hashToken(rawToken)
  const result = await pool.query(
    'SELECT "userId" FROM "PluginToken" WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
    [tokenHash]
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0] as Record<string, unknown>
  return row.userId as string
}

export const issueTokenFromPairingCode = async (
  code: string
): Promise<{ userId: string; token: string } | null> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const codeResult = await client.query(
      `SELECT id, "userId" FROM "PairingCode"
       WHERE code = $1 AND "usedAt" IS NULL AND "expiresAt" > NOW()`,
      [code]
    )

    if (codeResult.rows.length === 0) {
      await client.query("ROLLBACK")
      return null
    }

    const row = codeResult.rows[0] as Record<string, unknown>
    const userId = row.userId as string
    const codeId = row.id as string

    const plainToken = generateBearerToken()
    const tokenHash = hashToken(plainToken)
    const deviceName = `RuneLite Device (${new Date().toLocaleDateString("en-US", DEVICE_NAME_DATE_OPTIONS)})`

    await client.query(
      `INSERT INTO "PluginToken" (id, "userId", "tokenHash", "deviceName", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [userId, tokenHash, deviceName]
    )

    await client.query(
      `UPDATE "PairingCode" SET "usedAt" = NOW() WHERE id = $1`,
      [codeId]
    )

    await client.query("COMMIT")
    return { userId, token: plainToken }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
