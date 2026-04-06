import type { WebSocket } from "ws"
import type { QueryResult } from "pg"
import { handleMessage } from "../message-handler.js"
import { registry } from "../registry.js"
import { pool } from "../db.js"
import { writePresenceOnline, writePresenceOffline } from "../presence.js"
import { displaceAndRegisterRsn } from "../rsn.js"
import { PartyStatus, ApplicationStatus } from "../types.js"

vi.mock("../db.js", () => ({
  pool: { query: vi.fn() },
}))

vi.mock("../registry.js", () => ({
  registry: {
    updateRsn: vi.fn(),
    getConnectionByWs: vi.fn(),
  },
}))

vi.mock("../presence.js", () => ({
  writePresenceOnline: vi.fn(),
  writePresenceOffline: vi.fn(),
}))

vi.mock("../rsn.js", () => ({
  displaceAndRegisterRsn: vi.fn(),
}))

const mockQuery = vi.mocked(pool.query)
const mockUpdateRsn = vi.mocked(registry.updateRsn)
const mockGetConnectionByWs = vi.mocked(registry.getConnectionByWs)
const mockWritePresenceOnline = vi.mocked(writePresenceOnline)
const mockWritePresenceOffline = vi.mocked(writePresenceOffline)
const mockDisplaceAndRegisterRsn = vi.mocked(displaceAndRegisterRsn)

const queryResult = <T>(rows: T[]): QueryResult<T> => ({
  rows,
  rowCount: rows.length,
  command: "SELECT",
  oid: 0,
  fields: [],
  rowAsArray: false,
})

const createMockWs = (): WebSocket =>
  ({ send: vi.fn(), close: vi.fn() }) as unknown as WebSocket

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue(queryResult([]))
  mockWritePresenceOnline.mockResolvedValue(undefined)
  mockWritePresenceOffline.mockResolvedValue(undefined)
  mockDisplaceAndRegisterRsn.mockResolvedValue(undefined)
})

describe("handleMessage", () => {
  describe("IDENTIFY", () => {
    it("updates rsn in registry", async () => {
      const ws = createMockWs()
      await handleMessage(ws, "user-1", JSON.stringify({ type: "IDENTIFY", rsn: "PlayerOne" }))

      expect(mockUpdateRsn).toHaveBeenCalledWith(ws, "PlayerOne")
    })

    it("writes online presence", async () => {
      const ws = createMockWs()
      await handleMessage(ws, "user-1", JSON.stringify({ type: "IDENTIFY", rsn: "PlayerOne" }))

      expect(mockWritePresenceOnline).toHaveBeenCalledWith("user-1", "PlayerOne")
    })

    it("re-delivers unacked commands", async () => {
      const ws = createMockWs()
      mockQuery.mockResolvedValueOnce(
        queryResult([
          { id: "cmd-1", type: "JOIN_PARTY", passphrase: "abc", partyId: "p-1", reason: null },
        ])
      )

      await handleMessage(ws, "user-1", JSON.stringify({ type: "IDENTIFY", rsn: "PlayerOne" }))

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "COMMAND",
          id: "cmd-1",
          command: "JOIN_PARTY",
          passphrase: "abc",
          partyId: "p-1",
          reason: null,
        })
      )
    })
  })

  describe("ACK", () => {
    it("marks command as acknowledged in DB", async () => {
      const ws = createMockWs()
      await handleMessage(ws, "user-1", JSON.stringify({ type: "ACK", commandId: "cmd-1" }))

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ackedAt"),
        ["cmd-1", "user-1"]
      )
    })
  })

  describe("PARTY_STATE", () => {
    it("deletes PartyMember scoped to OPEN parties on LEFT", async () => {
      const ws = createMockWs()
      await handleMessage(
        ws,
        "user-1",
        JSON.stringify({ type: "PARTY_STATE", state: "LEFT", passphrase: null })
      )

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "PartyMember"'),
        ["user-1", PartyStatus.Open, ApplicationStatus.Withdrawn, ApplicationStatus.Accepted]
      )
    })

    it("updates application status to WITHDRAWN on LEFT", async () => {
      const ws = createMockWs()
      await handleMessage(
        ws,
        "user-1",
        JSON.stringify({ type: "PARTY_STATE", state: "LEFT", passphrase: null })
      )

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining(`UPDATE "Application"`),
        ["user-1", PartyStatus.Open, ApplicationStatus.Withdrawn, ApplicationStatus.Accepted]
      )
    })

    it("does not affect STARTED parties on LEFT", async () => {
      const ws = createMockWs()
      await handleMessage(
        ws,
        "user-1",
        JSON.stringify({ type: "PARTY_STATE", state: "LEFT", passphrase: null })
      )

      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining("'STARTED'"),
        expect.any(Array)
      )
    })

    it("does nothing on JOINED", async () => {
      const ws = createMockWs()
      await handleMessage(
        ws,
        "user-1",
        JSON.stringify({ type: "PARTY_STATE", state: "JOINED", passphrase: "abc" })
      )

      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  describe("PRESENCE", () => {
    it("writes online presence using connection rsn", async () => {
      const ws = createMockWs()
      mockGetConnectionByWs.mockReturnValue({
        ws,
        rsn: "PlayerOne",
        userId: "user-1",
        since: new Date(),
      })

      await handleMessage(ws, "user-1", JSON.stringify({ type: "PRESENCE", status: "online" }))

      expect(mockWritePresenceOnline).toHaveBeenCalledWith("user-1", "PlayerOne")
    })

    it("writes offline presence using connection rsn", async () => {
      const ws = createMockWs()
      mockGetConnectionByWs.mockReturnValue({
        ws,
        rsn: "PlayerOne",
        userId: "user-1",
        since: new Date(),
      })

      await handleMessage(ws, "user-1", JSON.stringify({ type: "PRESENCE", status: "offline" }))

      expect(mockWritePresenceOffline).toHaveBeenCalledWith("user-1", "PlayerOne")
    })

    it("does nothing when connection has no rsn", async () => {
      const ws = createMockWs()
      mockGetConnectionByWs.mockReturnValue({
        ws,
        rsn: null,
        userId: "user-1",
        since: new Date(),
      })

      await handleMessage(ws, "user-1", JSON.stringify({ type: "PRESENCE", status: "online" }))

      expect(mockWritePresenceOnline).not.toHaveBeenCalled()
    })
  })

  describe("invalid message", () => {
    it("sends ERROR for unparseable message", async () => {
      const ws = createMockWs()
      await handleMessage(ws, "user-1", "not json")

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "ERROR", message: "Invalid message format" })
      )
    })
  })
})
