import { createHash } from "crypto"
import type { PoolClient, QueryResult } from "pg"
import { validateToken, issueTokenFromPairingCode } from "./auth.js"
import { pool } from "./db.js"

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock("./db.js", () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}))

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)

const queryResult = <T>(rows: T[]): QueryResult<T> => ({
  rows,
  rowCount: rows.length,
  command: "SELECT",
  oid: 0,
  fields: [],
  rowAsArray: false,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockConnect.mockResolvedValue(mockClient as unknown as PoolClient)
  mockClient.query.mockResolvedValue(queryResult([]))
})

const hashToken = (plaintext: string): string =>
  createHash("sha256").update(plaintext).digest("hex")

describe("issueTokenFromPairingCode", () => {
  it("returns userId and token for a valid pairing code", async () => {
    mockClient.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([{ id: "code-1", userId: "user-1" }])) // SELECT PairingCode
      .mockResolvedValueOnce(queryResult([])) // INSERT PluginToken
      .mockResolvedValueOnce(queryResult([])) // UPDATE PairingCode
      .mockResolvedValueOnce(queryResult([])) // COMMIT

    const result = await issueTokenFromPairingCode("ABCD-1234")

    expect(result).not.toBeNull()
    expect(result?.userId).toBe("user-1")
    expect(typeof result?.token).toBe("string")
    expect(result?.token).toHaveLength(64) // 32 bytes hex
  })

  it("returns null for an unknown code", async () => {
    mockClient.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([])) // SELECT PairingCode — not found
      .mockResolvedValueOnce(queryResult([])) // ROLLBACK

    const result = await issueTokenFromPairingCode("XXXX-0000")

    expect(result).toBeNull()
  })

  it("returns null for an already-used code", async () => {
    mockClient.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([])) // SELECT PairingCode — usedAt IS NULL filters it out
      .mockResolvedValueOnce(queryResult([])) // ROLLBACK

    const result = await issueTokenFromPairingCode("USED-1234")

    expect(result).toBeNull()
  })

  it("returns null for an expired code", async () => {
    mockClient.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([])) // SELECT PairingCode — expiresAt > NOW() filters it out
      .mockResolvedValueOnce(queryResult([])) // ROLLBACK

    const result = await issueTokenFromPairingCode("EXPR-5678")

    expect(result).toBeNull()
  })

  it("rolls back and rethrows on DB error", async () => {
    const dbError = new Error("connection lost")
    mockClient.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockRejectedValueOnce(dbError) // SELECT PairingCode throws

    await expect(issueTokenFromPairingCode("ABCD-1234")).rejects.toThrow("connection lost")
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK")
    expect(mockClient.release).toHaveBeenCalled()
  })

  it("releases the client after success", async () => {
    mockClient.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockResolvedValueOnce(queryResult([{ id: "code-1", userId: "user-1" }])) // SELECT
      .mockResolvedValueOnce(queryResult([])) // INSERT
      .mockResolvedValueOnce(queryResult([])) // UPDATE
      .mockResolvedValueOnce(queryResult([])) // COMMIT

    await issueTokenFromPairingCode("ABCD-1234")

    expect(mockClient.release).toHaveBeenCalled()
  })
})

describe("validateToken", () => {
  it("returns userId for valid token", async () => {
    mockQuery.mockResolvedValue(queryResult([{ userId: "user-1" }]))

    const result = await validateToken("valid-token")

    expect(result).toBe("user-1")
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT "userId" FROM "PluginToken" WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
      [hashToken("valid-token")]
    )
  })

  it("returns null for unknown token", async () => {
    mockQuery.mockResolvedValue(queryResult([]))

    const result = await validateToken("unknown-token")

    expect(result).toBeNull()
  })

  it("returns null for revoked token", async () => {
    mockQuery.mockResolvedValue(queryResult([]))

    const result = await validateToken("revoked-token")

    expect(result).toBeNull()
  })

  it("hashes the token with sha256 before querying", async () => {
    mockQuery.mockResolvedValue(queryResult([]))

    await validateToken("test-token")

    const expectedHash = hashToken("test-token")
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [expectedHash])
  })
})
