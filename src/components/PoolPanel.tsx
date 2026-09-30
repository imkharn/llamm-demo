import { markedTvl, yesPrice } from "../sim/amm"
import { formatCents, formatCentsMove, formatShares, formatUsdc } from "../sim/format"
import { escrowNotional } from "../sim/lastLook"
import { useStore } from "../sim/store"

export function PoolPanel() {
  const { state } = useStore()
  const yes = yesPrice(state.pool)
  const tvl = markedTvl(state.pool)
  const escrow = escrowNotional(state.fills)
  const total = state.pool.yes + state.pool.no
  const yesWidth = total > 0 ? (state.pool.yes / total) * 100 : 50

  return (
    <div className="pool">
      <div className="hero">
        <div>
          <span>YES</span>
          <strong>{formatCents(yes)}</strong>
        </div>
        <div>
          <span>NO</span>
          <strong>{formatCents(1 - yes)}</strong>
        </div>
      </div>
      <div className="reserves">
        <div className="bar" aria-hidden="true">
          <span className="bar-yes" style={{ width: `${yesWidth}%` }} />
        </div>
        <div className="reserve-labels">
          <span>{formatShares(state.pool.yes)} YES</span>
          <span>{formatShares(state.pool.no)} NO</span>
        </div>
      </div>
      <dl className="stats">
        <div>
          <dt>Pool value</dt>
          <dd>{formatUsdc(tvl + state.balances.lp.usdc)}</dd>
        </div>
        <div>
          <dt>In escrow</dt>
          <dd>{formatUsdc(escrow)}</dd>
        </div>
        <div>
          <dt>Rebates collected</dt>
          <dd>{formatUsdc(state.rebates)}</dd>
        </div>
      </dl>
    </div>
  )
}

export function ActivityList() {
  const { state } = useStore()
  const items = state.activity.slice().reverse()
  if (items.length === 0) {
    return (
      <div className="empty">
        <p>No pool activity yet.</p>
        <p>Replacements show up here as rebates. Finalized trades release escrow to the trader.</p>
      </div>
    )
  }
  return (
    <div className="history">
      {items.map((item) => (
        <article key={item.id} className="trade">
          <div className="trade-top">
            <strong>{item.kind === "rebate" ? "Rebate" : "Finalized"}</strong>
            {item.priceBefore != null && item.priceAfter != null && (
              <span className="muted">{formatCentsMove(item.priceBefore, item.priceAfter)}</span>
            )}
          </div>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  )
}
