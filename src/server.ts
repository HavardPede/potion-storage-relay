import "dotenv/config"
import http from "http"
import { WebSocketServer, type WebSocket } from "ws"
import { validateToken, issueTokenFromPairingCode } from "./auth.js"
import { registry } from "./registry.js"
import { handleMessage } from "./message-handler.js"
import { writePresenceOffline } from "./presence.js"
import { startListener } from "./supabase-listener.js"
import { parseInbound } from "./types.js"

const PORT = parseInt(process.env.PORT ?? "8080", 10)
const AUTH_TIMEOUT_MS = 5_000
const PING_INTERVAL_MS = 30_000

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

  let authenticated = false
  let userId: string | null = null

  const timeout = setTimeout(() => {
    if (!authenticated) ws.close(1008, "Auth timeout")
  }, AUTH_TIMEOUT_MS)

  const activateSession = (resolvedUserId: string): void => {
    authenticated = true
    userId = resolvedUserId
    registry.add(userId, ws)
    ws.on("message", (d) => {
      handleMessage(ws, userId!, d.toString()).catch((err: unknown) => {
        console.error("[ws] message handler error:", err)
      })
    })
  }

  ws.once("message", async (data) => {
    clearTimeout(timeout)
    const raw = data.toString()
    const msg = parseInbound(raw)

    if (!msg || (msg.type !== "AUTH" && msg.type !== "PAIR")) {
      ws.send(JSON.stringify({ type: "AUTH_ERROR", reason: "First message must be AUTH or PAIR" }))
      ws.close(1008, "Auth required")
      return
    }

    if (msg.type === "PAIR") {
      try {
        const result = await issueTokenFromPairingCode(msg.code)
        if (!result) {
          console.log("[pair] failed: invalid or expired code")
          ws.send(JSON.stringify({ type: "PAIR_ERROR", reason: "Invalid or expired code" }))
          ws.close(1008, "Invalid pairing code")
          return
        }
        activateSession(result.userId)
        ws.send(JSON.stringify({ type: "PAIR_OK", token: result.token }))
        console.log(`[pair] success: userId=${result.userId}, connections=${registry.size()}`)
      } catch (err) {
        console.error("[pair] error:", err)
        ws.send(JSON.stringify({ type: "PAIR_ERROR", reason: "Internal error" }))
        ws.close(1011, "Internal error")
      }
      return
    }

    const validatedUserId = await validateToken(msg.token)
    if (!validatedUserId) {
      ws.send(JSON.stringify({ type: "AUTH_ERROR", reason: "Invalid token" }))
      ws.close(1008, "Invalid token")
      return
    }

    activateSession(validatedUserId)
    ws.send(JSON.stringify({ type: "AUTH_OK" }))
    console.log(`[ws] authenticated: userId=${validatedUserId}, connections=${registry.size()}`)
  })

  ws.on("close", () => {
    const conn = registry.remove(ws)
    if (conn?.rsn) {
      writePresenceOffline(conn.userId, conn.rsn).catch((err: unknown) => {
        console.error("[presence] offline write error:", err)
      })
    }
    if (userId) {
      console.log(`[ws] disconnected: userId=${userId}, connections=${registry.size()}`)
    }
  })

  ws.on("error", (err) => {
    console.error("[ws] error:", err)
  })
})

startListener()

server.listen(PORT, () => {
  console.log(`[relay] listening on port ${PORT}`)
})
