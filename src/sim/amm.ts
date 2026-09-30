import { formatShares, formatUsdc } from "./format"
import type { Asset, Pool, Side } from "./types"

/** Taken on the collateral that passes through the pool. Last-look matches are free. */
export const SWAP_FEE = 0.005

export interface Quote {
  shares: number
  usdc: number
  /** USDC paid or received per outcome share, including the swap fee. */
  price: number
  /** Collateral kept by the pool. */
  fee: number
  pool: Pool
  spotBefore: number
  spotAfter: number
}

export function yesPrice(pool: Pool): number {
  const sum = pool.yes + pool.no
  if (sum <= 0) return 0.5
  return pool.no / sum
}

/** Mark-to-market value of the reserves. Equals $1,000 at the 1,000/1,000 seed. */
export function markedTvl(pool: Pool): number {
  const sum = pool.yes + pool.no
  if (sum <= 0) return 0
  return (2 * pool.yes * pool.no) / sum
}

/** Curve quote with no fee. A buy spends `amount` USDC. A sell spends `amount` shares. */
export function quoteCurve(pool: Pool, side: Side, asset: Asset, amount: number): Quote | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null
  return side === "buy" ? buy(pool, asset, amount) : sell(pool, asset, amount)
}

export function quoteSwap(pool: Pool, side: Side, asset: Asset, amount: number): Quote | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null
  if (side === "buy") {
    const fee = amount * SWAP_FEE
    const quote = quoteCurve(pool, side, asset, amount - fee)
    if (!quote) return null
    return { ...quote, usdc: amount, price: amount / quote.shares, fee }
  }
  const quote = quoteCurve(pool, side, asset, amount)
  if (!quote) return null
  const fee = quote.usdc * SWAP_FEE
  const net = quote.usdc - fee
  return { ...quote, usdc: net, price: net / quote.shares, fee }
}

/**
 * Wallet actions for one pool fill.
 * A buy borrows the collateral to mint a complete set, sells the other outcome, and repays the loan.
 * The swap fee stays out of this list; it is already shown on the summary.
 */
export function poolActions(asset: Asset, side: Side, shares: number, usdc: number, fee: number): string[] {
  const other = asset === "YES" ? "NO" : "YES"
  if (side === "buy") {
    const net = usdc - fee
    const borrowed = formatUsdc(shares)
    return [
      `Flash borrow ${borrowed}`,
      `Create ${formatShares(shares)} complete sets`,
      `Swap ${formatShares(shares)} ${other} for ${formatUsdc(shares - net)}`,
      `Repay ${borrowed} flashloan`,
    ]
  }
  const gross = usdc + fee
  return [
    `Swap ${formatShares(shares - gross)} ${asset} for ${formatShares(gross)} ${other}`,
    `Redeem ${formatShares(gross)} complete sets`,
  ]
}

function buy(pool: Pool, asset: Asset, usdc: number): Quote | null {
  const spotBefore = yesPrice(pool)
  if (asset === "YES") {
    const shares = (usdc * (pool.yes + pool.no + usdc)) / (pool.no + usdc)
    const next = { yes: pool.yes + usdc - shares, no: pool.no + usdc }
    if (!(shares > 0) || next.yes <= 0 || next.no <= 0) return null
    return finish(next, shares, usdc, spotBefore)
  }
  const shares = (usdc * (pool.yes + pool.no + usdc)) / (pool.yes + usdc)
  const next = { yes: pool.yes + usdc, no: pool.no + usdc - shares }
  if (!(shares > 0) || next.yes <= 0 || next.no <= 0) return null
  return finish(next, shares, usdc, spotBefore)
}

function sell(pool: Pool, asset: Asset, shares: number): Quote | null {
  const spotBefore = yesPrice(pool)
  if (asset === "YES") {
    const usdc = collateralOut(pool.yes, pool.no, shares)
    if (usdc == null) return null
    const next = { yes: pool.yes + shares - usdc, no: pool.no - usdc }
    if (next.yes <= 0 || next.no <= 0) return null
    return finish(next, shares, usdc, spotBefore)
  }
  const usdc = collateralOut(pool.no, pool.yes, shares)
  if (usdc == null) return null
  const next = { yes: pool.yes - usdc, no: pool.no + shares - usdc }
  if (next.yes <= 0 || next.no <= 0) return null
  return finish(next, shares, usdc, spotBefore)
}

function collateralOut(reserveIn: number, reserveOther: number, shares: number): number | null {
  const sum = reserveIn + reserveOther + shares
  const disc = sum * sum - 4 * shares * reserveOther
  if (disc <= 0) return null
  const usdc = (sum - Math.sqrt(disc)) / 2
  if (!(usdc > 0) || usdc >= reserveOther) return null
  return usdc
}

function finish(next: Pool, shares: number, usdc: number, spotBefore: number): Quote | null {
  if (!(shares > 0) || !(usdc > 0)) return null
  return {
    shares,
    usdc,
    price: usdc / shares,
    fee: 0,
    pool: next,
    spotBefore,
    spotAfter: yesPrice(next),
  }
}

export function product(pool: Pool): number {
  return pool.yes * pool.no
}
