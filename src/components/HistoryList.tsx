import { formatCents, formatCountdown, formatShares, formatUsdc, sideLabel, userLabel } from "../sim/format"
import { useStore } from "../sim/store"
import type { Fill } from "../sim/types"

export function HistoryList() {
  const { state } = useStore()
  const mine = state.fills
    .filter((fill) => fill.owner === state.activeUser)
    .slice()
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.createdAt - a.createdAt)

  if (mine.length === 0) {
    return (
      <div className="empty">
        <p>No trades yet.</p>
      </div>
    )
  }

  const paused = state.speed === 0 && mine.some((fill) => fill.status === "pending")

  return (
    <div className="history">
      {paused && <p className="hint">The market clock is paused, so these countdowns are holding.</p>}
      {mine.map((fill) => (
        <article key={fill.id} className="trade">
          <div className="trade-top">
            <strong>{sideLabel(fill)}</strong>
            <span className={`badge badge-${fill.status}`}>{statusLabel(fill.status)}</span>
          </div>
          <p>
            {formatShares(fill.shares)} {fill.asset} at {formatCents(fill.price)}
          </p>
          <p className="muted">{detail(fill)}</p>
          {fill.status === "pending" && (
            <p className="countdown">Finalizes in {formatCountdown(fill.deadline - state.marketTime)}</p>
          )}
        </article>
      ))}
    </div>
  )
}

function detail(fill: Fill): string {
  if (fill.status === "pending") {
    return fill.side === "buy"
      ? `Spent ${formatUsdc(fill.price * fill.shares)}. Tokens release when this finalizes.`
      : `Selling into escrow. ${formatUsdc(fill.price * fill.shares)} releases when this finalizes.`
  }
  if (fill.status === "finalized") {
    return fill.side === "buy"
      ? `Received ${formatShares(fill.shares)} ${fill.asset}.`
      : `Received ${formatUsdc(fill.price * fill.shares)}.`
  }
  const profit = formatUsdc(fill.profitUsdc ?? 0)
  if (fill.replacedBy === fill.owner) {
    return `You improved this fill. ${profit} of the gap came back to you.`
  }
  const who = fill.replacedBy ? userLabel(fill.replacedBy) : "Someone"
  if (fill.side === "sell") {
    return `${who} replaced you. Returned ${formatShares(fill.returnedShares ?? 0)} ${fill.asset} and ${profit} profit.`
  }
  return `${who} replaced you. Paid ${formatUsdc(fill.payoutUsdc ?? 0)}, including ${profit} profit.`
}

function statusLabel(status: Fill["status"]): string {
  if (status === "pending") return "Pending"
  if (status === "finalized") return "Finalized"
  return "Replaced"
}

function statusRank(status: Fill["status"]): number {
  if (status === "pending") return 0
  if (status === "replaced") return 1
  return 2
}
