import type { ReactNode } from "react"
import { SWAP_FEE } from "../sim/amm"
import { formatCents, formatCentsMove, formatImpact, formatShares, formatUsdc, formatWindow, userLabel } from "../sim/format"
import { describeOutbid, describeSwap, routeLabel, swapActions } from "../sim/lastLook"
import { useStore } from "../sim/store"
import type { Asset, Side } from "../sim/types"
import { Avatar } from "./Header"
import { Hint } from "./Hint"

export interface SwapDraft {
  kind: "swap"
  side: Side
  asset: Asset
  amount: number
  improvePrice?: number
}

export interface OutbidDraft {
  kind: "outbid"
  fillId: string
  price: string
  size: string
}

export type ActionDraft = SwapDraft | OutbidDraft

export function WalletPanel({
  draft,
  error,
  onClose,
  onConfirm,
  onEdit,
}: {
  draft: ActionDraft
  error: string | null
  onClose: () => void
  onConfirm: () => void
  onEdit: (price: string, size: string) => void
}) {
  const { state } = useStore()
  const view = draft.kind === "swap" ? swapView(state, draft) : outbidView(state, draft, onEdit)
  const blocked = view.error
  const balances = state.balances[state.activeUser]

  return (
    <aside className={`wallet user-${state.activeUser}`} role="dialog" aria-label={view.title}>
      <div className="wallet-stripe" />
      <div className="wallet-body">
        <div className="wallet-account">
          <Avatar id={state.activeUser} />
          <div>
            <strong>{userLabel(state.activeUser)}</strong>
            <span>
              {formatUsdc(balances.usdc)}
              {balances.YES > 0 ? ` · ${formatShares(balances.YES)} YES` : ""}
              {balances.NO > 0 ? ` · ${formatShares(balances.NO)} NO` : ""}
            </span>
          </div>
        </div>
        <h2>{view.title}</h2>
        {view.banner && <p className="bet-line">{view.banner}</p>}
        {view.editor}
        <dl className="rows">
          {view.rows.map((row) => (
            <div key={row.label}>
              <dt>
                {row.label}
                {row.hint && <Hint text={row.hint} />}
              </dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        {view.steps && view.steps.length > 0 && (
          <ol className="tx-steps">
            {view.steps.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        )}
        {view.note && <p className="note">{view.note}</p>}
        {(blocked || error) && <p className="form-error">{blocked ?? error}</p>}
        <div className="wallet-actions">
          <button type="button" className="reject" onClick={onClose}>
            Reject
          </button>
          <button type="button" className="confirm" disabled={Boolean(blocked)} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </aside>
  )
}

function swapView(state: ReturnType<typeof useStore>["state"], draft: SwapDraft): PanelView {
  const described = describeSwap(state, {
    user: state.activeUser,
    side: draft.side,
    asset: draft.asset,
    amount: draft.amount,
    improvePrice: draft.improvePrice,
  })
  const title = draft.improvePrice != null ? "Confirm overpay" : "Confirm swap"
  if (!described.ok) return { title, rows: [], error: described.error }
  const preview = described.preview
  const stake = preview.usdc + (preview.improve?.netExtraUsdc ?? 0)
  const banner = preview.side === "buy" ? `Bet ${formatUsdc(stake)} to win ${formatUsdc(preview.shares)}` : null
  const rows: PanelRow[] = [
    {
      label: "Pay",
      value: preview.side === "buy" ? formatUsdc(preview.usdc) : `${formatShares(preview.shares)} ${preview.asset}`,
    },
    {
      label: "Receive",
      value:
        preview.side === "buy"
          ? `${formatShares(preview.shares)} ${preview.asset}`
          : formatUsdc(preview.improve ? preview.improve.newPrice * preview.shares : preview.usdc),
    },
    { label: "Destination", value: "Last look escrow" },
    { label: "Finalizes", value: `in ${formatWindow(state.params.windowMs)}` },
  ]
  if (preview.improve) {
    const overpaid = preview.improve.profit + preview.improve.rebate
    rows.push(
      { label: "Overpay", value: formatUsdc(overpaid) },
      {
        label: "Minimum received",
        value: preview.side === "buy" ? `${formatShares(preview.shares)} ${preview.asset}` : formatUsdc(preview.usdc),
      },
      { label: "Overpay price", value: formatCents(preview.improve.newPrice) },
      {
        label: "Comes back to you",
        value: formatUsdc(preview.improve.profit),
        hint: `You receive a discount equal to ${shareLabel(state.params.traderShare)} of the amount you overpaid`,
      },
      { label: "YES price", value: formatCentsMove(preview.improve.priceBefore, preview.improve.priceAfter) },
    )
  } else {
    rows.push(
      { label: "Price impact", value: formatImpact(preview.priceImpact) },
      {
        label: "Minimum received",
        value: preview.side === "buy" ? `${formatShares(preview.shares)} ${preview.asset}` : formatUsdc(preview.usdc),
      },
      { label: "Route", value: routeLabel(preview.legs, preview.asset) },
    )
  }
  rows.push({ label: "Fee", value: `${formatUsdc(preview.fee)} (${shareLabel(SWAP_FEE)})` })
  return { title, banner, rows, steps: swapActions(preview), error: null }
}

function outbidView(
  state: ReturnType<typeof useStore>["state"],
  draft: OutbidDraft,
  onEdit: (price: string, size: string) => void,
): PanelView {
  const fill = state.fills.find((item) => item.id === draft.fillId)
  const title = fill && fill.owner === state.activeUser ? "Improve your last look" : "Replace last look"
  const editor = (
    <div className="editors">
      <label>
        <span>Your price (¢)</span>
        <input value={draft.price} inputMode="decimal" onChange={(event) => onEdit(decimal(event.target.value), draft.size)} />
      </label>
      <label>
        <span>Size{fill ? ` of ${formatShares(fill.shares)}` : ""}</span>
        <input value={draft.size} inputMode="decimal" onChange={(event) => onEdit(draft.price, decimal(event.target.value))} />
      </label>
    </div>
  )
  if (!fill || fill.status !== "pending") return { title, rows: [], editor, error: "This last look is no longer open." }
  const described = describeOutbid(state, state.activeUser, draft.fillId, Number(draft.price) / 100, Number(draft.size))
  if (!described.ok) return { title, rows: [], editor, error: described.error }
  const preview = described.preview
  const rows = [
    { label: "Their price", value: formatCents(fill.price) },
    { label: "Your price", value: formatCents(preview.newPrice) },
    {
      label: fill.owner === state.activeUser ? "You receive now" : "They receive",
      value: displacedValue(preview.same, preview.payoutUsdc, preview.returnedShares, fill.asset, preview.profit),
    },
    { label: "Pool keeps", value: formatUsdc(preview.rebate) },
  ]
  if (preview.youPayShares > 0) {
    rows.push({ label: "You pay", value: `${formatShares(preview.youPayShares)} ${fill.asset}` })
  } else if (preview.youPayUsdc > 0) {
    rows.push({ label: "You pay", value: formatUsdc(preview.youPayUsdc) })
  }
  rows.push(
    {
      label: "You receive in escrow",
      value:
        preview.youReceiveShares > 0
          ? `${formatShares(preview.youReceiveShares)} ${fill.asset}`
          : formatUsdc(preview.youReceiveUsdc),
    },
    { label: "Window", value: `resets to ${formatWindow(state.params.windowMs)}` },
    { label: "YES price", value: formatCentsMove(preview.priceBefore, preview.priceAfter) },
  )
  return {
    title,
    rows,
    editor,
    error: null,
    note: preview.split
      ? "This is only part of the fill, so it splits. The rest stays with the original trader and keeps its timer."
      : null,
  }
}

function displacedValue(same: boolean, payout: number, returned: number, asset: Asset, profit: number): string {
  if (returned > 0) return `${formatShares(returned)} ${asset} and ${formatUsdc(profit)} profit`
  if (same) return formatUsdc(profit)
  return `${formatUsdc(payout)}, including ${formatUsdc(profit)} profit`
}

interface PanelRow {
  label: string
  value: string
  hint?: string
}

interface PanelView {
  title: string
  banner?: string | null
  rows: PanelRow[]
  steps?: string[]
  editor?: ReactNode
  note?: string | null
  error: string | null
}

function shareLabel(share: number): string {
  const pct = share * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

function decimal(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "")
  const [whole, ...rest] = cleaned.split(".")
  return rest.length ? `${whole}.${rest.join("")}` : whole
}
