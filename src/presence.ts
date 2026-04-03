import { pool } from "./db.js"

export const writePresenceOnline = async (userId: string, rsn: string): Promise<void> => {
  await pool.query(
    `INSERT INTO "PluginPresence" (id, "userId", rsn, status, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'online', NOW())
     ON CONFLICT ("userId", rsn) DO UPDATE SET status = 'online', "updatedAt" = NOW()`,
    [userId, rsn]
  )
}

export const writePresenceOffline = async (userId: string, rsn: string): Promise<void> => {
  await pool.query(
    `UPDATE "PluginPresence" SET status = 'offline', "updatedAt" = NOW()
     WHERE "userId" = $1 AND rsn = $2`,
    [userId, rsn]
  )
}
