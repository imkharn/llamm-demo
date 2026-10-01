import { useState } from "react"
import { formatCents, formatCountdown, formatShares, formatUsdc, sideLabel, userLabel } from "../sim/format"
import { useStore } from "../sim/store"
import type { Fill } from "../sim/types"

export function HistoryList() {
  const { state } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
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
      {mine.map((fill) => {
        const open = openId === fill.id
        return (
          <article key={fill.id} className={open ? "trade open" : "trade"}>
            <button type="button" className="trade-hit" onClick={() => setOpenId(open ? null : fill.id)}>
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
              <p className="muted">{open ? "Hide accounting" : "View accounting"}</p>
            </button>
            {open && <Ledger fill={fill} />}
          </article>
        )
      })}
    </div>
  )
}

function Ledger({ fill }: { fill: Fill }) {
  const { state } = useStore()
  const opened = fill.replacesId ? state.fills.find((item) => item.id === fill.replacesId) : undefined
  const closed = fill.successorId ? fill : undefined

  return (
    <div className="ledger">
      {opened ? <Replacement replaced={opened} showFee /> : <Opening fill={fill} />}
      {closed && (
        <>
          <h3>How this fill ended</h3>
          <Replacement replaced={closed} />
        </>
      )}
      {!closed && <Holding fill={fill} />}
    </div>
  )
}

function Opening({ fill }: { fill: Fill }) {
  const cost = fill.price * fill.shares
  return (
    <section>
      <h3>Opened on the pool</h3>
      <dl>
        <Row label="Trader" value={userLabel(fill.owner)} />
        <Row
          label={fill.side === "buy" ? "Paid" : "Sold"}
          value={fill.side === "buy" ? formatUsdc(cost) : `${formatShares(fill.shares)} ${fill.asset}`}
        />
        {fill.feeUsdc != null && fill.feeUsdc > 0 && <Row label="Swap fee kept by the pool" value={formatUsdc(fill.feeUsdc)} />}
      </dl>
    </section>
  )
}

function Holding({ fill }: { fill: Fill }) {
  const { state } = useStore()
  if (fill.status === "pending") {
    return (
      <p className="muted">
        Still in escrow. Finalizes in {formatCountdown(fill.deadline - state.marketTime)}, then{" "}
        {fill.side === "buy"
          ? `${formatShares(fill.shares)} ${fill.asset} is paid out.`
          : `${formatUsdc(fill.price * fill.shares)} is paid out.`}
      </p>
    )
  }
  if (fill.status === "finalized") {
    return (
      <p className="muted">
        Finalized.{" "}
        {fill.side === "buy"
          ? `Received ${formatShares(fill.shares)} ${fill.asset}.`
          : `Received ${formatUsdc(fill.price * fill.shares)}.`}
      </p>
    )
  }
  return null
}

function Replacement({ replaced, showFee = false }: { replaced: Fill; showFee?: boolean }) {
  const { state } = useStore()
  const successor = replaced.successorId
    ? state.fills.find((item) => item.id === replaced.successorId)
    : undefined
  const same = replaced.replacedBy === replaced.owner
  const shares = `${formatShares(replaced.shares)} ${replaced.asset}`
  const profit = formatUsdc(replaced.profitUsdc ?? 0)
  const rebate = formatUsdc(replaced.rebateUsdc ?? 0)

  return (
    <section>
      <h3>{same ? "Raised this fill" : "Superseding bid"}</h3>
      <dl>
        <Row label="Displaced trader" value={userLabel(replaced.owner)} />
        <Row label="Gave up" value={shares} />
        {replaced.side === "sell" && (
          <Row label="Tokens returned" value={`${formatShares(replaced.returnedShares ?? 0)} ${replaced.asset}`} />
        )}
        {replaced.side === "buy" && !same && (
          <Row label="Cash returned" value={formatUsdc(replaced.payoutUsdc ?? 0)} />
        )}
        <Row label={same ? "Share of the gap, not charged" : "Share of the gap"} value={profit} />
        <Row label="New trader" value={replaced.replacedBy ? userLabel(replaced.replacedBy) : "—"} />
        <Row label="New trader paid" value={newTraderPaid(replaced, successor, same)} />
        {successor && (
          <Row label="New fill" value={`${shares} at ${formatCents(successor.price)}, ${successorStatus(successor, state.marketTime)}`} />
        )}
        {showFee && replaced.feeUsdc != null && replaced.feeUsdc > 0 && (
          <Row label="Swap fee on the original fill" value={formatUsdc(replaced.feeUsdc)} />
        )}
        {replaced.rebateUsdc != null && <Row label="Pool kept" value={rebate} />}
        {replaced.priceBefore != null && replaced.priceAfter != null && (
          <Row
            label="YES price"
            value={`${formatCents(replaced.priceBefore)} → ${formatCents(replaced.priceAfter)}`}
          />
        )}
      </dl>
    </section>
  )
}

function newTraderPaid(replaced: Fill, successor: Fill | undefined, same: boolean): string {
  if (!successor) return "—"
  if (replaced.side === "sell") {
    return same ? `${formatUsdc(replaced.profitUsdc ?? 0)} credited now` : `${formatShares(successor.shares)} ${successor.asset}`
  }
  if (same) return formatUsdc(replaced.rebateUsdc ?? 0)
  return formatUsdc(successor.price * successor.shares)
}

function successorStatus(fill: Fill, marketTime: number): string {
  if (fill.status === "pending") return `still in escrow (${formatCountdown(fill.deadline - marketTime)} left)`
  if (fill.status === "finalized") {
    return fill.side === "buy"
      ? `finalized, received ${formatShares(fill.shares)} ${fill.asset}`
      : `finalized, received ${formatUsdc(fill.price * fill.shares)}`
  }
  return "later replaced"
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
