import { createHash } from "crypto"
import { pool } from "./db.js"

const HASH_ALGORITHM = "sha256"

const hashToken = (plaintext: string): string =>
  createHash(HASH_ALGORITHM).update(plaintext).digest("hex")

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
