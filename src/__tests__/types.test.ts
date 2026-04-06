import { parseInbound } from "../types.js"

describe("parseInbound", () => {
  it("parses valid AUTH message", () => {
    const result = parseInbound(JSON.stringify({ type: "AUTH", token: "abc123" }))
    expect(result).toEqual({ type: "AUTH", token: "abc123" })
  })

  it("parses valid IDENTIFY message", () => {
    const result = parseInbound(JSON.stringify({ type: "IDENTIFY", rsn: "PlayerOne" }))
    expect(result).toEqual({ type: "IDENTIFY", rsn: "PlayerOne" })
  })

  it("parses valid ACK message", () => {
    const result = parseInbound(JSON.stringify({ type: "ACK", commandId: "cmd-1" }))
    expect(result).toEqual({ type: "ACK", commandId: "cmd-1" })
  })

  it("parses valid PARTY_STATE message", () => {
    const result = parseInbound(
      JSON.stringify({ type: "PARTY_STATE", state: "LEFT", passphrase: null })
    )
    expect(result).toEqual({ type: "PARTY_STATE", state: "LEFT", passphrase: null })
  })

  it("parses valid PRESENCE message", () => {
    const result = parseInbound(JSON.stringify({ type: "PRESENCE", status: "online" }))
    expect(result).toEqual({ type: "PRESENCE", status: "online" })
  })

  it("returns null for invalid JSON", () => {
    expect(parseInbound("not json")).toBeNull()
  })

  it("returns null for unknown type", () => {
    expect(parseInbound(JSON.stringify({ type: "UNKNOWN" }))).toBeNull()
  })

  it("returns null for AUTH missing token", () => {
    expect(parseInbound(JSON.stringify({ type: "AUTH" }))).toBeNull()
  })

  it("returns null for IDENTIFY missing rsn", () => {
    expect(parseInbound(JSON.stringify({ type: "IDENTIFY" }))).toBeNull()
  })

  it("returns null for ACK missing commandId", () => {
    expect(parseInbound(JSON.stringify({ type: "ACK" }))).toBeNull()
  })

  it("returns null for PARTY_STATE with invalid state", () => {
    expect(parseInbound(JSON.stringify({ type: "PARTY_STATE", state: "INVALID" }))).toBeNull()
  })

  it("returns null for PRESENCE with invalid status", () => {
    expect(parseInbound(JSON.stringify({ type: "PRESENCE", status: "away" }))).toBeNull()
  })

  it("returns null for non-object input", () => {
    expect(parseInbound(JSON.stringify("string"))).toBeNull()
  })

  it("returns null for array input", () => {
    expect(parseInbound(JSON.stringify([1, 2]))).toBeNull()
  })
})
