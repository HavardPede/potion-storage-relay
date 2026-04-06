import "dotenv/config"
import http from "http"
import { WebSocketServer, type WebSocket } from "ws"
import { validateToken, issueTokenFromPairingCode } from "./auth.js"
import { registry } from "./registry.js"
import { handleMessage } from "./message-handler.js"
import { writePresenceOffline } from "./presence.js"
import { startCommandListener } from "./command-listener.js"
import { parseInbound } from "./types.js"

const PORT = parseInt(process.env.PORT ?? "8080", 10)
const AUTH_TIMEOUT_MS = 5_000
const PING_INTERVAL_MS = 30_000
const WS_CLOSE_AUTH_REQUIRED = 1008
const WS_CLOSE_INTERNAL_ERROR = 1011
const AUTH_ERROR_FIRST_MSG = "First message must be AUTH or PAIR"
const AUTH_ERROR_INVALID_TOKEN = "Invalid token"
const PAIR_ERROR_INVALID_CODE = "Invalid or expired code"
const PAIR_ERROR_INTERNAL = "Internal error"

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", connections: registry.size() }))
    return
  }
  res.writeHead(200)
  res.end("relay ok")
})

const wss = new WebSocketServer({ server })

const aliveSet = new WeakSet<WebSocket>()

const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!aliveSet.has(ws)) {
      ws.terminate()
      continue
    }
    aliveSet.delete(ws)
    ws.ping()
  }
}, PING_INTERVAL_MS)

wss.on("close", () => clearInterval(pingInterval))

wss.on("connection", (ws) => {
  aliveSet.add(ws)
  ws.on("pong", () => aliveSet.add(ws))

  const session = { authenticated: false, userId: null as string | null }
  const timeout = setTimeout(() => {
    if (!session.authenticated) ws.close(WS_CLOSE_AUTH_REQUIRED, "Auth timeout")
  }, AUTH_TIMEOUT_MS)

  ws.once("message", async (data) => {
    clearTimeout(timeout)
    await handleFirstMessage(ws, session, data.toString())
  })

  ws.on("close", () => handleDisconnect(ws, session.userId))
  ws.on("error", (err) => console.error("[ws] error:", err))
})

startCommandListener()

server.listen(PORT, () => {
  console.log(`[relay] listening on port ${PORT}`)
})

type Session = { authenticated: boolean; userId: string | null }

const activateSession = (ws: WebSocket, session: Session, userId: string): void => {
  session.authenticated = true
  session.userId = userId
  registry.add(userId, ws)
  ws.on("message", (d) => {
    handleMessage(ws, userId, d.toString()).catch((err: unknown) => {
      console.error("[ws] message handler error:", err)
    })
  })
}

const handlePairMessage = async (ws: WebSocket, code: string, session: Session): Promise<void> => {
  try {
    const result = await issueTokenFromPairingCode(code)
    if (!result) {
      console.log("[pair] failed: invalid or expired code")
      ws.send(JSON.stringify({ type: "PAIR_ERROR", reason: PAIR_ERROR_INVALID_CODE }))
      ws.close(WS_CLOSE_AUTH_REQUIRED, "Invalid pairing code")
      return
    }
    activateSession(ws, session, result.userId)
    ws.send(JSON.stringify({ type: "PAIR_OK", token: result.token }))
    console.log(`[pair] success: userId=${result.userId}, connections=${registry.size()}`)
  } catch (err) {
    console.error("[pair] error:", err)
    ws.send(JSON.stringify({ type: "PAIR_ERROR", reason: PAIR_ERROR_INTERNAL }))
    ws.close(WS_CLOSE_INTERNAL_ERROR, "Internal error")
  }
}

const handleAuthMessage = async (ws: WebSocket, token: string, session: Session): Promise<void> => {
  const userId = await validateToken(token)
  if (!userId) {
    ws.send(JSON.stringify({ type: "AUTH_ERROR", reason: AUTH_ERROR_INVALID_TOKEN }))
    ws.close(WS_CLOSE_AUTH_REQUIRED, "Invalid token")
    return
  }
  activateSession(ws, session, userId)
  ws.send(JSON.stringify({ type: "AUTH_OK" }))
  console.log(`[ws] authenticated: userId=${userId}, connections=${registry.size()}`)
}

const handleFirstMessage = async (ws: WebSocket, session: Session, raw: string): Promise<void> => {
  const msg = parseInbound(raw)
  if (!msg || (msg.type !== "AUTH" && msg.type !== "PAIR")) {
    ws.send(JSON.stringify({ type: "AUTH_ERROR", reason: AUTH_ERROR_FIRST_MSG }))
    ws.close(WS_CLOSE_AUTH_REQUIRED, "Auth required")
    return
  }
  if (msg.type === "PAIR") {
    await handlePairMessage(ws, msg.code, session)
    return
  }
  await handleAuthMessage(ws, msg.token, session)
}

const handleDisconnect = (ws: WebSocket, userId: string | null): void => {
  const conn = registry.remove(ws)
  if (conn?.rsn) {
    writePresenceOffline(conn.userId, conn.rsn).catch((err: unknown) => {
      console.error("[presence] offline write error:", err)
    })
  }
  if (userId) {
    console.log(`[ws] disconnected: userId=${userId}, connections=${registry.size()}`)
  }
}
