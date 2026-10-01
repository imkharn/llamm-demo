import { useState } from "react"
import { formatCents, formatCountdown, formatShares, formatUsdc, sideLabel, userLabel } from "../sim/format"
import { liveHead, orderEconomics } from "../sim/lastLook"
import { useStore } from "../sim/store"
import type { Fill, UserId } from "../sim/types"

export function HistoryList() {
  const { state } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const mine = visibleFills(state.fills, state.activeUser).sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || b.createdAt - a.createdAt,
  )

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
      {mine.map((fill) => {
        const open = openId === fill.id
        const event = accountingEvent(fill, state.fills)
        return (
          <article key={fill.id} className={open ? "trade open" : "trade"}>
            <button
              type="button"
              className={event ? "trade-hit" : "trade-hit static"}
              onClick={() => {
                if (!event) return
                setOpenId(open ? null : fill.id)
              }}
            >
              <div className="trade-top">
                <strong>
                  {fill.owner === state.activeUser ? sideLabel(fill) : `${userLabel(fill.owner)} · ${sideLabel(fill)}`}
                </strong>
                <span className={`badge badge-${fill.status}`}>{statusLabel(fill.status)}</span>
              </div>
              <p>
                {formatShares(fill.shares)} {fill.asset} at {formatCents(fill.price)}
              </p>
              <p className="muted">{detail(fill)}</p>
              {fill.status === "pending" && (
                <p className="countdown">Finalizes in {formatCountdown(fill.deadline - state.marketTime)}</p>
              )}
              {event && <p className="muted">{open ? "Hide accounting" : "View accounting"}</p>}
            </button>
            {open && event && <Ledger event={event} />}
          </article>
        )
      })}
    </div>
  )
}

function visibleFills(fills: Fill[], user: UserId): Fill[] {
  const heads = new Map<string, Fill>()
  for (const fill of fills) {
    if (fill.owner !== user && fill.replacedBy !== user) continue
    const head = liveHead(fill, fills)
    heads.set(head.id, head)
  }
  return [...heads.values()]
}

function accountingEvent(fill: Fill, fills: Fill[]): Fill | undefined {
  if (!fill.replacesId) return undefined
  return fills.find((item) => item.id === fill.replacesId)
}

function Ledger({ event }: { event: Fill }) {
  const { state } = useStore()
  const profit = event.profitUsdc ?? 0
  const notional = event.price * event.shares
  const economics = orderEconomics(event, state.fills, state.activity, state.params.traderShare)
  return (
    <div className="ledger">
      <dl>
        <Row label="New Trader" value={event.replacedBy ? userLabel(event.replacedBy) : "—"} />
        <Row label="Displaced Trader" value={userLabel(event.owner)} />
        <Row label="Original Order" value={orderText(event, event.price)} />
        <Row label="New Order" value={orderText(event, economics.nextPrice)} />
        <Row
          label="AMM revenue"
          value={`${formatUsdc(economics.revenueBefore)} → ${formatUsdc(economics.revenueAfter)}`}
        />
        <Row label="Profit paid to displaced trader" value={`${formatUsdc(profit)}${roiText(profit, notional)}`} />
      </dl>
    </div>
  )
}

function orderText(fill: Fill, price: number): string {
  const verb = fill.side === "buy" ? "Buy" : "Sell"
  return `${verb} ${formatShares(fill.shares)} ${fill.asset} for ${formatUsdc(price * fill.shares)}`
}

function roiText(profit: number, notional: number): string {
  if (!(notional > 0)) return ""
  const pct = Math.round((profit / notional) * 10000) / 100
  const text = Number.isInteger(pct) ? String(pct) : String(pct)
  return ` (${text}% ROI)`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
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
