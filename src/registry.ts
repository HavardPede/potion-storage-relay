import type { WebSocket } from "ws"

export interface Connection {
  readonly ws: WebSocket
  rsn: string | null
  readonly userId: string
  readonly since: Date
}

const MAX_CONNECTIONS_PER_USER = 5

const connections = new Map<string, Connection[]>()

const add = (userId: string, ws: WebSocket): void => {
  const existing = connections.get(userId) ?? []

  if (existing.length >= MAX_CONNECTIONS_PER_USER) {
    const oldest = existing.shift()
    oldest?.ws.close(1001, "Replaced by newer connection")
  }

  existing.push({ ws, rsn: null, userId, since: new Date() })
  connections.set(userId, existing)
}

const remove = (ws: WebSocket): Connection | undefined => {
  for (const [userId, conns] of connections) {
    const index = conns.findIndex((c) => c.ws === ws)
    if (index !== -1) {
      const [removed] = conns.splice(index, 1)
      if (conns.length === 0) connections.delete(userId)
      return removed
    }
  }
  return undefined
}

const updateRsn = (ws: WebSocket, rsn: string): void => {
  for (const conns of connections.values()) {
    const conn = conns.find((c) => c.ws === ws)
    if (conn) {
      conn.rsn = rsn
      return
    }
  }
}

const getByUserAndRsn = (userId: string, rsn: string | null): WebSocket[] => {
  const conns = connections.get(userId)
  if (!conns) return []

  if (rsn === null) return conns.map((c) => c.ws)
  return conns.filter((c) => c.rsn === rsn).map((c) => c.ws)
}

const getConnectionByWs = (ws: WebSocket): Connection | undefined => {
  for (const conns of connections.values()) {
    const conn = conns.find((c) => c.ws === ws)
    if (conn) return conn
  }
  return undefined
}

const size = (): number => {
  let total = 0
  for (const conns of connections.values()) {
    total += conns.length
  }
  return total
}

const clear = (): void => {
  connections.clear()
}

export const registry = {
  add,
  remove,
  updateRsn,
  getByUserAndRsn,
  getConnectionByWs,
  size,
  clear,
}
