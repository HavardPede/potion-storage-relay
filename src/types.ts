// --- Inbound (plugin -> relay) ---

interface AuthMessage {
  readonly type: "AUTH"
  readonly token: string
}

interface IdentifyMessage {
  readonly type: "IDENTIFY"
  readonly rsn: string
}

interface AckMessage {
  readonly type: "ACK"
  readonly commandId: string
}

interface PartyStateMessage {
  readonly type: "PARTY_STATE"
  readonly state: "LEFT" | "JOINED"
  readonly passphrase: string | null
}

interface PresenceMessage {
  readonly type: "PRESENCE"
  readonly status: "online" | "offline"
}

interface PairMessage {
  readonly type: "PAIR"
  readonly code: string
}

export type InboundMessage =
  | AuthMessage
  | IdentifyMessage
  | AckMessage
  | PartyStateMessage
  | PresenceMessage
  | PairMessage

// --- Outbound (relay -> plugin) ---

interface AuthOkMessage {
  readonly type: "AUTH_OK"
}

interface AuthErrorMessage {
  readonly type: "AUTH_ERROR"
  readonly reason: string
}

interface CommandMessage {
  readonly type: "COMMAND"
  readonly id: string
  readonly command: "JOIN_PARTY" | "LEAVE_PARTY"
  readonly passphrase: string | null
  readonly partyId: string | null
  readonly reason: string | null
}

interface ErrorMessage {
  readonly type: "ERROR"
  readonly message: string
}

interface PairOkMessage {
  readonly type: "PAIR_OK"
  readonly token: string
}

interface PairErrorMessage {
  readonly type: "PAIR_ERROR"
  readonly reason: string
}

export type OutboundMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | CommandMessage
  | ErrorMessage
  | PairOkMessage
  | PairErrorMessage

// --- Type guards ---

const isString = (value: unknown): value is string =>
  typeof value === "string"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const INBOUND_TYPES = new Set(["AUTH", "IDENTIFY", "ACK", "PARTY_STATE", "PRESENCE", "PAIR"])

const isValidAuth = (msg: Record<string, unknown>): boolean =>
  isString(msg.token)

const isValidIdentify = (msg: Record<string, unknown>): boolean =>
  isString(msg.rsn)

const isValidAck = (msg: Record<string, unknown>): boolean =>
  isString(msg.commandId)

const isValidPartyState = (msg: Record<string, unknown>): boolean =>
  (msg.state === "LEFT" || msg.state === "JOINED")

const isValidPresence = (msg: Record<string, unknown>): boolean =>
  (msg.status === "online" || msg.status === "offline")

const isValidPair = (msg: Record<string, unknown>): boolean =>
  isString(msg.code)

const FIELD_VALIDATORS: Record<string, (msg: Record<string, unknown>) => boolean> = {
  AUTH: isValidAuth,
  IDENTIFY: isValidIdentify,
  ACK: isValidAck,
  PARTY_STATE: isValidPartyState,
  PRESENCE: isValidPresence,
  PAIR: isValidPair,
}

const buildInbound = (msg: Record<string, unknown>): InboundMessage | null => {
  switch (msg.type) {
    case "AUTH":
      return { type: "AUTH", token: msg.token as string }
    case "IDENTIFY":
      return { type: "IDENTIFY", rsn: msg.rsn as string }
    case "ACK":
      return { type: "ACK", commandId: msg.commandId as string }
    case "PARTY_STATE":
      return {
        type: "PARTY_STATE",
        state: msg.state as "LEFT" | "JOINED",
        passphrase: (msg.passphrase as string) ?? null,
      }
    case "PRESENCE":
      return { type: "PRESENCE", status: msg.status as "online" | "offline" }
    case "PAIR":
      return { type: "PAIR", code: msg.code as string }
    default:
      return null
  }
}

export const parseInbound = (raw: string): InboundMessage | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (!isString(parsed.type)) return null
  if (!INBOUND_TYPES.has(parsed.type)) return null

  const validator = FIELD_VALIDATORS[parsed.type]
  if (!validator(parsed)) return null

  return buildInbound(parsed)
}
