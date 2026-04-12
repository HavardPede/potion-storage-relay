import type { WebSocket } from "ws"
import { routeCommand } from "../command-listener.js"
import { registry } from "../registry.js"

vi.mock("../registry.js", () => ({
  registry: {
    getByUserAndRsn: vi.fn(),
  },
}))

vi.mock("../pg-listen.js", () => ({
  startPgListener: vi.fn(),
}))

const mockGetByUserAndRsn = vi.mocked(registry.getByUserAndRsn)

const createMockWs = (): WebSocket =>
  ({ send: vi.fn(), close: vi.fn() }) as unknown as WebSocket

beforeEach(() => {
  vi.clearAllMocks()
})

describe("routeCommand", () => {
  it("sends command to matching connections", () => {
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    mockGetByUserAndRsn.mockReturnValue([ws1, ws2])

    routeCommand({
      id: "cmd-1",
      userId: "user-1",
      type: "JOIN_PARTY",
      passphrase: "abc",
      partyId: "p-1",
      reason: null,
      role: null,
      rsn: "PlayerOne",
    })

    const expected = JSON.stringify({
      type: "COMMAND",
      id: "cmd-1",
      command: "JOIN_PARTY",
      passphrase: "abc",
      partyId: "p-1",
      reason: null,
      role: null,
    })
    expect(ws1.send).toHaveBeenCalledWith(expected)
    expect(ws2.send).toHaveBeenCalledWith(expected)
  })

  it("looks up connections by userId and rsn", () => {
    mockGetByUserAndRsn.mockReturnValue([])

    routeCommand({
      id: "cmd-1",
      userId: "user-1",
      type: "LEAVE_PARTY",
      passphrase: null,
      partyId: "p-1",
      reason: "kicked",
      role: null,
      rsn: "PlayerTwo",
    })

    expect(mockGetByUserAndRsn).toHaveBeenCalledWith("user-1", "PlayerTwo")
  })

  it("does nothing when no connections match", () => {
    mockGetByUserAndRsn.mockReturnValue([])

    routeCommand({
      id: "cmd-1",
      userId: "user-1",
      type: "JOIN_PARTY",
      passphrase: null,
      partyId: null,
      reason: null,
      role: null,
      rsn: null,
    })

    // no error thrown
  })

  it("continues sending to remaining connections when one throws", () => {
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    vi.mocked(ws1.send).mockImplementation(() => {
      throw new Error("connection closed")
    })
    mockGetByUserAndRsn.mockReturnValue([ws1, ws2])

    routeCommand({
      id: "cmd-1",
      userId: "user-1",
      type: "ROLE_CHANGE",
      passphrase: null,
      partyId: "p-1",
      reason: null,
      role: "healer",
      rsn: "PlayerOne",
    })

    expect(ws2.send).toHaveBeenCalled()
  })
})
