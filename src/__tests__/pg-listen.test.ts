import pg from "pg"
import { startPgListener, type NotificationHandler } from "../pg-listen.js"

interface MockClient {
  connect: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
}

let mockClients: MockClient[] = []

const buildMockClient = (): MockClient => ({
  connect: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  removeAllListeners: vi.fn(),
})

vi.mock("pg", () => ({
  default: {
    Client: vi.fn(() => {
      const client = buildMockClient()
      mockClients.push(client)
      return client
    }),
  },
}))

const latestClient = (): MockClient => mockClients[mockClients.length - 1]

const getCallback = (client: MockClient, event: string): ((...args: unknown[]) => void) => {
  const call = client.on.mock.calls.find(([e]: [string]) => e === event)
  return call?.[1] as (...args: unknown[]) => void
}

const flushAsync = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockClients = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe("startPgListener", () => {
  it("connects and listens on specified channels", async () => {
    startPgListener(["channel_a", "channel_b"], vi.fn())
    await flushAsync()

    const client = latestClient()
    expect(client.connect).toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith("LISTEN channel_a")
    expect(client.query).toHaveBeenCalledWith("LISTEN channel_b")
  })

  it("forwards notifications to handler", async () => {
    const handler: NotificationHandler = vi.fn()
    startPgListener(["test_channel"], handler)
    await flushAsync()

    const onNotification = getCallback(latestClient(), "notification")
    onNotification({ channel: "test_channel", payload: '{"id":"1"}' })

    expect(handler).toHaveBeenCalledWith("test_channel", '{"id":"1"}')
  })

  it("ignores notifications without payload", async () => {
    const handler: NotificationHandler = vi.fn()
    startPgListener(["test_channel"], handler)
    await flushAsync()

    const onNotification = getCallback(latestClient(), "notification")
    onNotification({ channel: "test_channel" })

    expect(handler).not.toHaveBeenCalled()
  })

  it("sends keepalive queries on interval", async () => {
    startPgListener(["test_channel"], vi.fn())
    await flushAsync()

    const client = latestClient()
    const callsBefore = client.query.mock.calls.length

    await vi.advanceTimersByTimeAsync(30_000)

    expect(client.query).toHaveBeenCalledWith("SELECT 1")
    expect(client.query.mock.calls.length).toBe(callsBefore + 1)
  })

  it("reconnects when keepalive fails", async () => {
    startPgListener(["test_channel"], vi.fn())
    await flushAsync()

    const firstClient = latestClient()
    firstClient.query.mockRejectedValueOnce(new Error("connection lost"))

    await vi.advanceTimersByTimeAsync(30_000)

    expect(firstClient.end).toHaveBeenCalled()
    expect(firstClient.removeAllListeners).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5_000)

    const secondClient = latestClient()
    expect(secondClient).not.toBe(firstClient)
    expect(secondClient.connect).toHaveBeenCalled()
  })

  it("reconnects on connection error", async () => {
    startPgListener(["test_channel"], vi.fn())
    await flushAsync()

    const firstClient = latestClient()
    const onError = getCallback(firstClient, "error")
    onError(new Error("connection reset"))

    expect(firstClient.end).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5_000)

    const secondClient = latestClient()
    expect(secondClient).not.toBe(firstClient)
    expect(secondClient.connect).toHaveBeenCalled()
  })

  it("reconnects when initial connect fails", async () => {
    vi.mocked(pg.Client).mockImplementationOnce(() => {
      const client = buildMockClient()
      client.connect.mockRejectedValue(new Error("ECONNREFUSED"))
      mockClients.push(client)
      return client as unknown as pg.Client
    })

    startPgListener(["test_channel"], vi.fn())
    await flushAsync()

    const failedClient = latestClient()

    await vi.advanceTimersByTimeAsync(5_000)

    const secondClient = latestClient()
    expect(secondClient).not.toBe(failedClient)
    expect(secondClient.connect).toHaveBeenCalled()
  })
})
