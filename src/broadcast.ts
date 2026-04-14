const buildBroadcastUrl = (): string =>
  `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`

export const broadcastUserEvent = async (
  userId: string,
  event: string,
  payload: Record<string, unknown> = {}
): Promise<void> => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey || !process.env.SUPABASE_URL) return

  try {
    await fetch(buildBroadcastUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        messages: [{ topic: `user-events-${userId}`, event, payload }],
      }),
    })
  } catch {
    // Fire-and-forget: broadcast failures must not block relay operations
  }
}
