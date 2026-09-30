import { describe, expect, it } from "vitest"
import { markedTvl, poolActions, product, quoteCurve, quoteSwap, yesPrice } from "./amm"
import type { Pool } from "./types"

function invariant(pool: Pool, seed: Pool): void {
  expect(Math.abs(product(pool) - product(seed)) / product(seed)).toBeLessThan(1e-9)
}

describe("amm", () => {
  const seed: Pool = { yes: 1000, no: 1000 }

  it("starts at 50¢ with $1,000 of full-range liquidity", () => {
    expect(yesPrice(seed)).toBeCloseTo(0.5, 10)
    expect(markedTvl(seed)).toBeCloseTo(1000, 8)
  })

  it("buys YES without changing the constant product", () => {
    const quote = quoteSwap(seed, "buy", "YES", 100)
    expect(quote).not.toBeNull()
    expect(quote!.fee).toBeCloseTo(0.5, 8)
    expect(quote!.price).toBeCloseTo(100 / quote!.shares, 8)
    expect(quote!.spotAfter).toBeGreaterThan(0.5)
    invariant(quote!.pool, seed)
  })

  it("lists a YES buy as a flashloan that is repaid, without a fee action", () => {
    const steps = poolActions("YES", "buy", 10, 5.0352, 0.0252)
    expect(steps).toEqual([
      "Flash borrow $10.00",
      "Create 10 complete sets (YES + NO)",
      "Sell 10 NO for $4.99",
      "Repay $10.00 flashloan",
    ])
  })

  it("buys YES by minting a complete set and selling NO", () => {
    const quote = quoteSwap(seed, "buy", "YES", 100)!
    const net = quote.usdc - quote.fee
    const sold = quoteCurve(seed, "sell", "NO", quote.shares)!
    expect(sold.usdc).toBeCloseTo(quote.shares - net, 6)
    expect(sold.pool.yes).toBeCloseTo(quote.pool.yes, 6)
    expect(sold.pool.no).toBeCloseTo(quote.pool.no, 6)
  })

  it("buys NO by minting a complete set and selling YES", () => {
    const quote = quoteSwap(seed, "buy", "NO", 100)!
    const net = quote.usdc - quote.fee
    const sold = quoteCurve(seed, "sell", "YES", quote.shares)!
    expect(sold.usdc).toBeCloseTo(quote.shares - net, 6)
    expect(sold.pool.yes).toBeCloseTo(quote.pool.yes, 6)
    expect(sold.pool.no).toBeCloseTo(quote.pool.no, 6)
  })

  it("buys NO and moves the YES price down", () => {
    const quote = quoteSwap(seed, "buy", "NO", 100)!
    expect(quote.spotAfter).toBeLessThan(0.5)
    invariant(quote.pool, seed)
  })

  it("sells YES and keeps the constant product", () => {
    const quote = quoteSwap(seed, "sell", "YES", 100)!
    expect(quote.usdc).toBeGreaterThan(0)
    expect(quote.usdc).toBeLessThan(100)
    expect(quote.spotAfter).toBeLessThan(0.5)
    invariant(quote.pool, seed)
  })
})
