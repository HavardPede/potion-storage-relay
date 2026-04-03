import "dotenv/config"
import http from "http"
import { WebSocketServer } from "ws"
import { validateToken } from "./auth.js"
import { registry } from "./registry.js"
import { handleMessage } from "./message-handler.js"
import { writePresenceOffline } from "./presence.js"
import { startListener } from "./supabase-listener.js"
import { parseInbound } from "./types.js"

const PORT = parseInt(process.env.PORT ?? "8080", 10)
const AUTH_TIMEOUT_MS = 5_000

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

wss.on("connection", (ws) => {
  let authenticated = false
  let userId: string | null = null

  const timeout = setTimeout(() => {
    if (!authenticated) ws.close(1008, "Auth timeout")
  }, AUTH_TIMEOUT_MS)

  ws.once("message", async (data) => {
    clearTimeout(timeout)
    const raw = data.toString()
    const msg = parseInbound(raw)

    if (!msg || msg.type !== "AUTH") {
      ws.send(JSON.stringify({ type: "AUTH_ERROR", reason: "First message must be AUTH" }))
      ws.close(1008, "Auth required")
      return
    }

    const validatedUserId = await validateToken(msg.token)
    if (!validatedUserId) {
      ws.send(JSON.stringify({ type: "AUTH_ERROR", reason: "Invalid token" }))
      ws.close(1008, "Invalid token")
      return
    }

    authenticated = true
    userId = validatedUserId
    registry.add(userId, ws)
    ws.send(JSON.stringify({ type: "AUTH_OK" }))
    console.log(`[ws] authenticated: userId=${userId}, connections=${registry.size()}`)

    ws.on("message", (d) => {
      handleMessage(ws, userId!, d.toString()).catch((err: unknown) => {
        console.error("[ws] message handler error:", err)
      })
    })
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
