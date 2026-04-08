export enum PartyStatus {
  Open = "OPEN",
  Closed = "CLOSED",
}

export enum ApplicationStatus {
  Pending = "PENDING",
  Accepted = "ACCEPTED",
  Withdrawn = "WITHDRAWN",
}

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
  readonly command: "JOIN_PARTY" | "LEAVE_PARTY" | "ROLE_CHANGE"
  readonly passphrase: string | null
  readonly partyId: string | null
  readonly reason: string | null
  readonly role: string | null
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

export const parseInbound = (raw: string): InboundMessage | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (!isString(parsed.type)) return null

  switch (parsed.type) {
    case "AUTH": return parseAuth(parsed)
    case "IDENTIFY": return parseIdentify(parsed)
    case "ACK": return parseAck(parsed)
    case "PARTY_STATE": return parsePartyState(parsed)
    case "PRESENCE": return parsePresence(parsed)
    case "PAIR": return parsePair(parsed)
    default: return null
  }
}

const isString = (value: unknown): value is string =>
  typeof value === "string"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseAuth = (msg: Record<string, unknown>): AuthMessage | null =>
  isString(msg.token) ? { type: "AUTH", token: msg.token } : null

const parseIdentify = (msg: Record<string, unknown>): IdentifyMessage | null =>
  isString(msg.rsn) ? { type: "IDENTIFY", rsn: msg.rsn } : null

const parseAck = (msg: Record<string, unknown>): AckMessage | null =>
  isString(msg.commandId) ? { type: "ACK", commandId: msg.commandId } : null

const parsePartyState = (msg: Record<string, unknown>): PartyStateMessage | null => {
  if (msg.state !== "LEFT" && msg.state !== "JOINED") return null
  return {
    type: "PARTY_STATE",
    state: msg.state,
    passphrase: isString(msg.passphrase) ? msg.passphrase : null,
  }
}

const parsePresence = (msg: Record<string, unknown>): PresenceMessage | null => {
  if (msg.status !== "online" && msg.status !== "offline") return null
  return { type: "PRESENCE", status: msg.status }
}

const parsePair = (msg: Record<string, unknown>): PairMessage | null =>
  isString(msg.code) ? { type: "PAIR", code: msg.code } : null
