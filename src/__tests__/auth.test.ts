import { createHash } from "crypto"
import { validateToken } from "../auth.js"
import { pool } from "../db.js"

vi.mock("../db.js", () => ({
  pool: { query: vi.fn() },
}))

const mockQuery = vi.mocked(pool.query)

beforeEach(() => {
  vi.clearAllMocks()
})

const hashToken = (plaintext: string): string =>
  createHash("sha256").update(plaintext).digest("hex")

describe("validateToken", () => {
  it("returns userId for valid token", async () => {
    mockQuery.mockResolvedValue({ rows: [{ userId: "user-1" }] } as never)

    const result = await validateToken("valid-token")

    expect(result).toBe("user-1")
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT "userId" FROM "PluginToken" WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
      [hashToken("valid-token")]
    )
  })

  it("returns null for unknown token", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    const result = await validateToken("unknown-token")

    expect(result).toBeNull()
  })

  it("returns null for revoked token", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    const result = await validateToken("revoked-token")

    expect(result).toBeNull()
  })

  it("hashes the token with sha256 before querying", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    await validateToken("test-token")

    const expectedHash = hashToken("test-token")
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [expectedHash])
  })
})
