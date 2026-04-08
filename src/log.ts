const isDebug = process.env.DEBUG === "true"

export const log = {
  info: (...args: unknown[]): void => console.log(...args),
  error: (...args: unknown[]): void => console.error(...args),
  debug: (...args: unknown[]): void => {
    if (isDebug) console.log("[debug]", ...args)
  },
}
