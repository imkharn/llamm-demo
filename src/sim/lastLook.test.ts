import { describe, expect, it } from "vitest"
import { yesPrice } from "./amm"
import { WINDOW_MS, applyOutbid, applySwap, describeSwap, finalizeDue, initialState, quoteInput } from "./lastLook"
import type { Fill, MarketState } from "./types"

function swapYes(amount = 100) {
  return applySwap(initialState(), {
    user: "trader1",
    side: "buy",
    asset: "YES",
    amount,
  })
}

describe("last look", () => {
  it("puts a buy in escrow instead of the wallet", () => {
    const result = swapYes()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.balances.trader1.usdc).toBeCloseTo(900, 6)
    expect(result.state.balances.trader1.YES).toBe(0)
    expect(result.state.balances.lp.usdc).toBeCloseTo(0.5, 6)
    const fill = result.state.fills[0]
    expect(fill.status).toBe("pending")
    expect(fill.shares).toBeGreaterThan(180)
    expect(fill.shares).toBeLessThan(190.91)
    expect(fill.deadline).toBe(WINDOW_MS)
    expect(yesPrice(result.state.pool)).toBeGreaterThan(0.5)
  })

  it("rejects an outbid under 2% and accepts the rounded 2% quote", () => {
    const swapped = swapYes()
    if (!swapped.ok) throw new Error(swapped.error)
    const fill = swapped.state.fills[0]
    const tooSmall = applyOutbid(swapped.state, "trader2", fill.id, fill.price * 1.01, fill.shares)
    expect(tooSmall.ok).toBe(false)

    const shown = Number((fill.price * 1.02 * 100).toFixed(2)) / 100
    const ok = applyOutbid(swapped.state, "trader2", fill.id, shown, fill.shares)
    expect(ok.ok).toBe(true)
  })

  it("pays the displaced trader cost plus 10% and sends 90% to the pool", () => {
    const swapped = swapYes()
    if (!swapped.ok) throw new Error(swapped.error)
    const fill = swapped.state.fills[0]
    const aged: MarketState = { ...swapped.state, marketTime: 5_000 }
    const newPrice = fill.price * 1.02
    const out = applyOutbid(aged, "trader2", fill.id, newPrice, fill.shares)
    if (!out.ok) throw new Error(out.error)

    const gap = newPrice - fill.price
    const profit = 0.1 * gap * fill.shares
    const rebate = 0.9 * gap * fill.shares
    const replaced = out.state.fills.find((item) => item.status === "replaced")!
    const pending = out.state.fills.find((item) => item.status === "pending")!
    expect(replaced.payoutUsdc).toBeCloseTo(100 + profit, 5)
    expect(replaced.profitUsdc).toBeCloseTo(profit, 6)
    expect(out.state.balances.trader1.usdc).toBeCloseTo(1000 + profit, 5)
    expect(out.state.balances.trader2.usdc).toBeCloseTo(1000 - newPrice * fill.shares, 5)
    expect(out.state.balances.trader2.YES).toBe(0)
    expect(out.state.rebates).toBeCloseTo(rebate, 5)
    expect(pending.owner).toBe("trader2")
    expect(pending.deadline).toBe(5_000 + WINDOW_MS)
    expect(pending.price).toBeCloseTo(newPrice, 8)
  })

  it("splits a partial outbid and keeps the original timer on the remainder", () => {
    const swapped = swapYes()
    if (!swapped.ok) throw new Error(swapped.error)
    const fill = swapped.state.fills[0]
    const aged: MarketState = { ...swapped.state, marketTime: 8_000 }
    const half = fill.shares / 2
    const out = applyOutbid(aged, "trader2", fill.id, fill.price * 1.02, half)
    if (!out.ok) throw new Error(out.error)

    const remainder = out.state.fills.find((item) => item.id === fill.id)!
    const created = out.state.fills.find((item) => item.status === "pending" && item.owner === "trader2")!
    expect(remainder.status).toBe("pending")
    expect(remainder.owner).toBe("trader1")
    expect(remainder.shares).toBeCloseTo(half, 6)
    expect(remainder.deadline).toBe(fill.deadline)
    expect(created.shares).toBeCloseTo(half, 6)
    expect(created.deadline).toBe(8_000 + WINDOW_MS)
    expect(out.state.fills.filter((item) => item.status === "replaced")).toHaveLength(1)
  })

  it("nets a self-bundle as the AMM cost plus 90% of the gap", () => {
    const start = initialState()
    const probe = applySwap(start, { user: "trader1", side: "buy", asset: "YES", amount: 100 })
    if (!probe.ok) throw new Error(probe.error)
    const price = probe.state.fills[0].price
    const shares = probe.state.fills[0].shares
    const bundled = applySwap(start, {
      user: "trader1",
      side: "buy",
      asset: "YES",
      amount: 100,
      improvePrice: price * 1.02,
    })
    if (!bundled.ok) throw new Error(bundled.error)
    const gap = price * 0.02
    const rebate = 0.9 * gap * shares
    expect(bundled.state.balances.trader1.usdc).toBeCloseTo(1000 - 100 - rebate, 5)
    expect(bundled.state.balances.trader1.YES).toBe(0)
    const pending = bundled.state.fills.filter((item) => item.status === "pending")
    expect(pending).toHaveLength(1)
    expect(pending[0].price).toBeCloseTo(price * 1.02, 8)
    expect(pending[0].owner).toBe("trader1")
    const replaced = bundled.state.fills.find((item) => item.status === "replaced")!
    expect(replaced.profitUsdc).toBeCloseTo(0.1 * gap * shares, 6)
    expect(replaced.replacedBy).toBe("trader1")
    expect(replaced.successorId).toBe(pending[0].id)
    expect(pending[0].replacesId).toBe(replaced.id)
    expect(replaced.rebateUsdc).toBeCloseTo(rebate, 6)
    expect(replaced.feeUsdc).toBeCloseTo(0.5, 6)
    expect(bundled.state.activity.some((item) => item.fillId === replaced.id && item.kind === "rebate")).toBe(true)
  })

  it("finalizes into the holder's wallet after the window", () => {
    const swapped = swapYes()
    if (!swapped.ok) throw new Error(swapped.error)
    const shares = swapped.state.fills[0].shares
    const done = finalizeDue({ ...swapped.state, marketTime: WINDOW_MS })
    expect(done.balances.trader1.YES).toBeCloseTo(shares, 6)
    expect(done.fills[0].status).toBe("finalized")
    const again = finalizeDue(done)
    expect(again.balances.trader1.YES).toBeCloseTo(shares, 6)
  })

  it("refuses to outbid a buy within 2% of 100¢", () => {
    const state = initialState()
    const fill: Fill = {
      id: "f9",
      owner: "trader1",
      side: "buy",
      asset: "YES",
      shares: 10,
      price: 1 / 1.02,
      deadline: WINDOW_MS,
      createdAt: 0,
      status: "pending",
    }
    const blocked = applyOutbid({ ...state, fills: [fill] }, "trader2", "f9", 1, 10)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.toLowerCase()).toContain("100")
  })

  it("returns a displaced seller's tokens plus 10% and escrows the cheaper sale", () => {
    let state = initialState()
    state = {
      ...state,
      balances: {
        ...state.balances,
        trader1: { usdc: 1000, YES: 100, NO: 0 },
        trader2: { usdc: 1000, YES: 100, NO: 0 },
      },
    }
    const sold = applySwap(state, { user: "trader1", side: "sell", asset: "YES", amount: 50 })
    if (!sold.ok) throw new Error(sold.error)
    const fill = sold.state.fills[0]
    expect(sold.state.balances.trader1.YES).toBeCloseTo(50, 6)
    expect(sold.state.balances.trader1.usdc).toBeCloseTo(1000, 6)

    const newPrice = fill.price * 0.98
    const out = applyOutbid(sold.state, "trader2", fill.id, newPrice, fill.shares)
    if (!out.ok) throw new Error(out.error)
    const profit = 0.1 * (fill.price - newPrice) * fill.shares
    expect(out.state.balances.trader1.YES).toBeCloseTo(100, 6)
    expect(out.state.balances.trader1.usdc).toBeCloseTo(1000 + profit, 5)
    expect(out.state.balances.trader2.YES).toBeCloseTo(50, 6)
    expect(out.state.balances.trader2.usdc).toBeCloseTo(1000, 6)

    const pending = out.state.fills.find((item) => item.status === "pending")!
    const finalized = finalizeDue({ ...out.state, marketTime: pending.deadline })
    expect(finalized.balances.trader2.usdc).toBeCloseTo(1000 + newPrice * fill.shares, 5)
    expect(finalized.fills.find((item) => item.id === pending.id)?.status).toBe("finalized")
  })

  it("buys a cheaper last look before touching the pool", () => {
    const first = swapYes()
    if (!first.ok) throw new Error(first.error)
    const fill = first.state.fills[0]
    const bound = fill.price * 1.02
    expect(bound).toBeLessThan(yesPrice(first.state.pool))

    const second = applySwap(first.state, { user: "trader2", side: "buy", asset: "YES", amount: 20 })
    if (!second.ok) throw new Error(second.error)
    const pending = second.state.fills.find((item) => item.status === "pending" && item.owner === "trader2")!
    expect(pending.price).toBeCloseTo(bound, 6)
    expect(pending.shares).toBeCloseTo(20 / bound, 4)
    const rest = second.state.fills.find((item) => item.id === fill.id)!
    expect(rest.status).toBe("pending")
    expect(rest.owner).toBe("trader1")
    expect(rest.shares).toBeCloseTo(fill.shares - pending.shares, 4)
  })

  it("leaves a last look alone when the pool is cheaper, even if an overpay would beat it", () => {
    const state = initialState()
    const fill: Fill = {
      id: "f9",
      owner: "trader1",
      side: "buy",
      asset: "YES",
      shares: 10,
      price: 0.8,
      deadline: WINDOW_MS,
      createdAt: 0,
      status: "pending",
    }
    const bought = applySwap(
      { ...state, fills: [fill], nextId: 10 },
      { user: "trader2", side: "buy", asset: "YES", amount: 10, improvePrice: 0.6 },
    )
    if (!bought.ok) throw new Error(bought.error)
    expect(bought.state.fills.find((item) => item.id === "f9")!.status).toBe("pending")
    const mine = bought.state.fills.find((item) => item.owner === "trader2" && item.status === "pending")!
    expect(mine.price).toBeCloseTo(0.6, 6)
  })

  it("raises a cheap last look to the overpay price after taking it", () => {
    const first = swapYes()
    if (!first.ok) throw new Error(first.error)
    const bound = first.state.fills[0].price * 1.02
    const target = bound * 1.02
    const second = applySwap(first.state, {
      user: "trader2",
      side: "buy",
      asset: "YES",
      amount: 20,
      improvePrice: target,
    })
    if (!second.ok) throw new Error(second.error)
    const shares = 20 / bound
    const rebate = 0.9 * (target - bound) * shares
    expect(second.state.balances.trader2.usdc).toBeCloseTo(1000 - 20 - rebate, 4)
    const pending = second.state.fills.find((item) => item.owner === "trader2" && item.status === "pending")!
    expect(pending.price).toBeCloseTo(target, 6)
    expect(pending.shares).toBeCloseTo(shares, 4)
  })

  it("solves the USDC input for a chosen number of shares", () => {
    const start = initialState()
    const bought = describeSwap(start, { user: "trader1", side: "buy", asset: "YES", amount: 100 })
    if (!bought.ok) throw new Error(bought.error)
    const solved = quoteInput(start, { user: "trader1", side: "buy", asset: "YES", output: bought.preview.shares })
    expect(solved).toBeCloseTo(100, 4)
  })
})
