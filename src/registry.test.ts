import type { WebSocket } from "ws"
import { registry } from "./registry.js"

const createMockWs = (): WebSocket =>
  ({ close: vi.fn(), send: vi.fn() }) as unknown as WebSocket

beforeEach(() => {
  registry.clear()
})

describe("registry", () => {
  describe("add and size", () => {
    it("stores a connection and increments size", () => {
      registry.add("user-1", createMockWs())
      expect(registry.size()).toBe(1)
    })

    it("stores multiple connections for the same user", () => {
      registry.add("user-1", createMockWs())
      registry.add("user-1", createMockWs())
      expect(registry.size()).toBe(2)
    })

    it("evicts oldest connection when exceeding max per user", () => {
      const oldest = createMockWs()
      registry.add("user-1", oldest)

      for (let i = 0; i < 5; i++) {
        registry.add("user-1", createMockWs())
      }

      expect(oldest.close).toHaveBeenCalledWith(1001, "Replaced by newer connection")
      expect(registry.size()).toBe(5)
    })
  })

  describe("remove", () => {
    it("removes a connection and returns it", () => {
      const ws = createMockWs()
      registry.add("user-1", ws)

      const removed = registry.remove(ws)

      expect(removed).toBeDefined()
      expect(removed?.userId).toBe("user-1")
      expect(registry.size()).toBe(0)
    })

    it("returns undefined for unknown ws", () => {
      expect(registry.remove(createMockWs())).toBeUndefined()
    })
  })

  describe("updateRsn", () => {
    it("updates the rsn for a connection", () => {
      const ws = createMockWs()
      registry.add("user-1", ws)
      registry.updateRsn(ws, "PlayerOne")

      const conn = registry.getConnectionByWs(ws)
      expect(conn?.rsn).toBe("PlayerOne")
    })
  })

  describe("getByUserAndRsn", () => {
    it("returns only connections matching rsn", () => {
      const ws1 = createMockWs()
      const ws2 = createMockWs()
      registry.add("user-1", ws1)
      registry.add("user-1", ws2)
      registry.updateRsn(ws1, "PlayerOne")
      registry.updateRsn(ws2, "PlayerTwo")

      expect(registry.getByUserAndRsn("user-1", "PlayerOne")).toEqual([ws1])
    })

    it("returns all connections when rsn is null", () => {
      const ws1 = createMockWs()
      const ws2 = createMockWs()
      registry.add("user-1", ws1)
      registry.add("user-1", ws2)

      expect(registry.getByUserAndRsn("user-1", null)).toEqual([ws1, ws2])
    })

    it("returns empty array for unknown user", () => {
      expect(registry.getByUserAndRsn("unknown", null)).toEqual([])
    })
  })

  describe("getConnectionByWs", () => {
    it("returns the connection for a known ws", () => {
      const ws = createMockWs()
      registry.add("user-1", ws)

      const conn = registry.getConnectionByWs(ws)
      expect(conn?.userId).toBe("user-1")
    })

    it("returns undefined for unknown ws", () => {
      expect(registry.getConnectionByWs(createMockWs())).toBeUndefined()
    })
  })
})
