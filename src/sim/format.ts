import type { Fill, UserId } from "./types"

export function userLabel(id: UserId): string {
  if (id === "trader1") return "Trader 1"
  if (id === "trader2") return "Trader 2"
  return "Liquidity provider"
}

export function formatUsdc(n: number): string {
  const abs = Math.abs(n)
  const digits = abs > 0 && abs < 1 ? 4 : 2
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })
}

export function formatCents(price: number): string {
  return `${(price * 100).toFixed(2)}¢`
}

/** Polymarket-style chance: whole percent, or one decimal when it is not a round number. */
export function formatChance(probability: number): string {
  const pct = probability * 100
  const rounded = Math.round(pct * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}%`
}

export function formatImpact(fraction: number): string {
  const pct = fraction * 100
  const abs = Math.abs(pct)
  const digits = abs !== 0 && abs < 0.01 ? 4 : 2
  return `${pct.toFixed(digits)}%`
}

/** Enough decimals that a small rebate still shows a price change. */
export function formatCentsMove(before: number, after: number): string {
  const deltaCents = Math.abs(after - before) * 100
  const digits = deltaCents > 0 && deltaCents < 0.05 ? 4 : 2
  const text = (n: number) => `${(n * 100).toFixed(digits)}¢`
  return `${text(before)} → ${text(after)}`
}

export function formatShares(n: number): string {
  const digits = n >= 100 ? 2 : 4
  return n.toLocaleString("en-US", { maximumFractionDigits: digits })
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s"
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
  return `${s}s`
}

export function formatWindow(ms: number): string {
  const minutes = ms / 60000
  if (minutes < 60) {
    const rounded = Math.round(minutes * 10) / 10
    return rounded === 1 ? "1 minute" : `${rounded} minutes`
  }
  const hours = ms / 3600000
  const rounded = Math.round(hours * 100) / 100
  return rounded === 1 ? "1 hour" : `${rounded} hours`
}

export function formatInputNumber(n: number): string {
  if (!Number.isFinite(n)) return ""
  const digits = Math.abs(n) >= 100 ? 2 : 4
  const factor = 10 ** digits
  return String(Math.round(n * factor) / factor)
}

export function sideLabel(fill: Pick<Fill, "side" | "asset">): string {
  return `${fill.side === "buy" ? "Buy" : "Sell"} ${fill.asset}`
}
