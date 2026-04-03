import { createClient } from "@supabase/supabase-js"
import { registry } from "./registry.js"
import type { OutboundMessage } from "./types.js"

export const startListener = (): void => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  supabase
    .channel("plugin-commands")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "PluginCommand" },
      (payload) => {
        const row = payload.new as Record<string, unknown>
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
        for (const ws of connections) {
          ws.send(serialized)
        }
      }
    )
    .subscribe((status) => {
      console.log(`[supabase] subscription status: ${status}`)
    })
}
