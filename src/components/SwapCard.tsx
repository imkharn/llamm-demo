import { useEffect, useRef, useState } from "react"
import { yesPrice } from "../sim/amm"
import { formatCents, formatChance, formatImpact, formatInputNumber, formatShares, formatUsdc, formatWindow } from "../sim/format"
import { SWAP_FEE } from "../sim/amm"
import { describeSwap, fitSwapAmount, lastLookChance, quoteInput, routeLabel } from "../sim/lastLook"
import { useStore } from "../sim/store"
import type { Asset, Side } from "../sim/types"
import { Hint } from "./Hint"
import type { SwapDraft } from "./WalletPanel"

type Token = "USDC" | Asset

export function SwapCard({ onSwap }: { onSwap: (draft: SwapDraft) => void }) {
  const { state } = useStore()
  const [payToken, setPayToken] = useState<Token>("USDC")
  const [receiveAsset, setReceiveAsset] = useState<Asset>("YES")
  const [payText, setPayText] = useState("")
  const [receiveText, setReceiveText] = useState("")
  const [edited, setEdited] = useState<"pay" | "receive">("pay")
  const [improveOn, setImproveOn] = useState(false)
  const [improveText, setImproveText] = useState("")
  const [picking, setPicking] = useState<"pay" | "receive" | null>(null)
  const suggestedPrice = useRef("")
  const fittedPrice = useRef("")

  const side: Side = payToken === "USDC" ? "buy" : "sell"
  const asset: Asset = payToken === "USDC" ? receiveAsset : payToken
  const desiredOut = edited === "receive" && receiveText !== "" ? Number(receiveText) : null
  const solvedIn =
    desiredOut != null && Number.isFinite(desiredOut) && desiredOut > 0
      ? quoteInput(state, { user: state.activeUser, side, asset, output: desiredOut })
      : null
  const tradeAmount = edited === "pay" ? (payText === "" ? 0 : Number(payText)) : (solvedIn ?? 0)
  const balance = payToken === "USDC" ? state.balances[state.activeUser].usdc : state.balances[state.activeUser][payToken]
  const base = { user: state.activeUser, side, asset, amount: tradeAmount }
  const quoted = describeSwap(state, base)
  const improvePrice = improveOn ? (improveText.trim() === "" ? Number.NaN : Number(improveText) / 100) : undefined
  const priced = improvePrice != null && Number.isFinite(improvePrice)
  const spendCap = edited === "pay" && tradeAmount > 0 ? Math.min(tradeAmount, balance) : balance
  const fittedAmount =
    priced && side === "buy" && tradeAmount > 0
      ? fitSwapAmount(state, { ...base, improvePrice }, spendCap)
      : tradeAmount
  const described = priced
    ? describeSwap(state, { ...base, amount: fittedAmount, improvePrice })
    : quoted
  const overpayAt = quoted.ok ? quoted.preview.overpayAt : null

  const yes = yesPrice(state.pool)
  const implied = lastLookChance(state.fills)
  const preview = described.ok ? described.preview : quoted.ok ? quoted.preview : null

  const fittedShares = described.ok && side === "buy" ? described.preview.shares : null
  useEffect(() => {
    if (edited !== "receive" || !priced || fittedShares == null || desiredOut == null) return
    if (fittedPrice.current === improveText) return
    const digits = fittedShares >= 100 ? 2 : 4
    const factor = 10 ** digits
    const affordable = Math.floor(fittedShares * factor) / factor
    if (desiredOut > affordable + 1e-6) {
      fittedPrice.current = improveText
      setReceiveText(String(affordable))
    }
  }, [improveText, edited, priced, fittedShares, desiredOut])

  useEffect(() => {
    if (!improveOn || overpayAt == null) return
    const text = (overpayAt * 100).toFixed(2)
    if (improveText === "" || improveText === suggestedPrice.current) {
      suggestedPrice.current = text
      setImproveText(text)
    }
  }, [improveOn, improveText, overpayAt])

  useEffect(() => {
    if (!picking) return
    function onPointer(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element) || !target.closest(".token-wrap")) setPicking(null)
    }
    document.addEventListener("mousedown", onPointer)
    return () => document.removeEventListener("mousedown", onPointer)
  }, [picking])

  const outputUnfillable = edited === "receive" && desiredOut != null && desiredOut > 0 && solvedIn == null
  const buttonLabel = outputUnfillable
    ? "The pool cannot fill this amount."
    : !described.ok
    ? improveOn && improveText.trim() === "" && tradeAmount > 0
      ? "Enter a price"
      : described.error
    : improveOn
      ? "Overpay"
      : "Swap"

  function flip() {
    if (payToken === "USDC") setPayToken(receiveAsset)
    else {
      setReceiveAsset(payToken)
      setPayToken("USDC")
    }
    setPayText("")
    setReceiveText("")
    setEdited("pay")
    setImproveOn(false)
    setImproveText("")
    suggestedPrice.current = ""
  }

  function toggleImprove() {
    setImproveOn((on) => !on)
    fittedPrice.current = ""
    if (improveOn) {
      setImproveText("")
      suggestedPrice.current = ""
    }
  }

  function submit() {
    if (!described.ok) return
    onSwap({
      kind: "swap",
      side,
      asset,
      amount: fittedAmount,
      improvePrice: improveOn ? Number(improveText) / 100 : undefined,
    })
  }

  return (
    <form
      className="swap"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <h1 className="market">
        Will John Smith Drop Out of the Presidential Election? <span className="chance">{formatChance(yes)}</span>
        {implied != null && <span className="implied"> ({formatChance(implied)})</span>}
      </h1>

      <div className="stack">
        <Well
          label="You pay"
          value={edited === "pay" ? payText : solvedIn != null ? formatInputNumber(solvedIn) : ""}
          onChange={(value) => {
            setEdited("pay")
            setPayText(value)
          }}
          token={payToken}
          balance={payToken === "USDC" ? formatUsdc(balance) : `${formatShares(balance)} ${payToken}`}
          onMax={() => {
            setEdited("pay")
            setPayText(formatInputNumber(balance))
          }}
          open={picking === "pay"}
          onToggle={() => setPicking((current) => (current === "pay" ? null : "pay"))}
          choices={["USDC", "YES", "NO"]}
          onPick={(token) => {
            setPayToken(token)
            setPayText("")
            setReceiveText("")
            setEdited("pay")
            setPicking(null)
            setImproveOn(false)
          }}
        />
        <button type="button" className="flip" aria-label="Switch pay and receive" onClick={flip}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.5 V13.5 M4.2 9.6 L8 13.5 L11.8 9.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Well
          label="You receive"
          value={
            edited === "receive"
              ? receiveText
              : described.ok
                ? formatInputNumber(side === "buy" ? described.preview.shares : described.preview.usdc)
                : ""
          }
          onChange={(value) => {
            setEdited("receive")
            setReceiveText(value)
          }}
          token={side === "buy" ? asset : "USDC"}
          open={picking === "receive"}
          onToggle={
            side === "buy" ? () => setPicking((current) => (current === "receive" ? null : "receive")) : undefined
          }
          choices={["YES", "NO"]}
          onPick={(token) => {
            if (token !== "USDC") setReceiveAsset(token)
            setPayText("")
            setReceiveText("")
            setEdited("pay")
            setPicking(null)
            setImproveOn(false)
          }}
        />
      </div>
      <p className="escrow-note">
        <span>
          For the first {formatWindow(state.params.windowMs)} your profit from this trade may be limited to{" "}
          {shareLabel(state.params.traderShare)} of the price movement
        </span>
        <Hint text={escrowTip(state.params.windowMs, state.params.minOutbid, state.params.traderShare)} />
      </p>

      {preview && (
        <dl className="details">
          <div>
            <dt>Price</dt>
            <dd>
              1 {asset} = {formatCents(preview.price)}
            </dd>
          </div>
          <div>
            <dt>Price impact</dt>
            <dd className={preview.priceImpact > 0.05 ? "impact-bad" : preview.priceImpact < -0.0005 ? "impact-good" : undefined}>
              {formatImpact(preview.priceImpact)}
            </dd>
          </div>
          <div>
            <dt>Minimum received</dt>
            <dd>
              {preview.side === "buy" ? `${formatShares(preview.shares)} ${preview.asset}` : formatUsdc(preview.usdc)}
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>{routeLabel(preview.legs, preview.asset)}</dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>
              {formatUsdc(preview.fee)} ({shareLabel(SWAP_FEE)})
            </dd>
          </div>
        </dl>
      )}

      <div className="improve">
        <label className="check">
          <input type="checkbox" checked={improveOn} onChange={toggleImprove} />
          <span>Offer to overpay</span>
          <Hint text={overpayTip(state.params.windowMs, state.params.minOutbid)} />
        </label>
        {improveOn && (
          <div className="improve-body">
            <label>
              <span>Your price (¢)</span>
              <input inputMode="decimal" value={improveText} onChange={(event) => setImproveText(decimal(event.target.value))} />
            </label>
          </div>
        )}
      </div>

      <button type="submit" className="action" disabled={!described.ok || outputUnfillable}>
        {buttonLabel}
      </button>
    </form>
  )
}

function Well({
  label,
  value,
  onChange,
  token,
  balance,
  onMax,
  readOnly,
  open,
  onToggle,
  choices,
  onPick,
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  token: Token
  balance?: string
  onMax?: () => void
  readOnly?: boolean
  open: boolean
  onToggle?: () => void
  choices: Token[]
  onPick: (token: Token) => void
}) {
  return (
    <div className="well">
      <div className="well-top">
        <span>{label}</span>
        {balance && (
          <span className="balance">
            Balance: {balance}
            {onMax && (
              <button type="button" className="max" onClick={onMax}>
                Max
              </button>
            )}
          </span>
        )}
      </div>
      <div className="amount-row">
        <input
          className="amount"
          inputMode="decimal"
          placeholder="0"
          value={value}
          readOnly={readOnly}
          aria-label={label}
          onChange={(event) => onChange?.(decimal(event.target.value))}
        />
        <div className="token-wrap">
          {onToggle ? (
            <button type="button" className="token" onClick={onToggle}>
              <TokenDot token={token} />
              {token}
              <Caret />
            </button>
          ) : (
            <span className="token static">
              <TokenDot token={token} />
              {token}
            </span>
          )}
          {open && (
            <div className="menu token-menu" role="listbox">
              {choices.map((choice) => (
                <button type="button" key={choice} className="menu-item" onClick={() => onPick(choice)}>
                  <TokenDot token={choice} />
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TokenDot({ token }: { token: Token }) {
  return <span className={`dot dot-${token.toLowerCase()}`} aria-hidden="true" />
}

function Caret() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function decimal(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "")
  const [whole, ...rest] = cleaned.split(".")
  return rest.length ? `${whole}.${rest.join("")}` : whole
}

function shareLabel(share: number): string {
  const pct = share * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

function escrowTip(windowMs: number, minOutbid: number, traderShare: number): string {
  const window = formatWindow(windowMs)
  const cash = 1 + traderShare * 10
  const rounded = Math.round(cash * 10) / 10
  const cashText = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `For the first ${window} your purchase is held in escrow and anyone can offer a price that is at least ${shareLabel(minOutbid)} better. If they do, this trade will be undone and you will be paid ${shareLabel(traderShare)} of the profit. After ${window}, your purchase is finalized and can be withdrawn from the AMM. For example, if you buy for 1¢, but the price changes to 11¢ an hour later, you will be cashed out at ${cashText}¢ per share.`
}

function overpayTip(windowMs: number, minOutbid: number): string {
  return `If you are confident the market odds will change by more than ${shareLabel(minOutbid)} in the next ${formatWindow(windowMs)} you might make more profit by choosing to pay the lowest price that will not be outbid. The most profitable bid is ${shareLabel(minOutbid)} less than what the market price will be ${formatWindow(windowMs)} from now`
}
