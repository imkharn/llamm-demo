import { describe, expect, it } from "vitest"
import { markedTvl, yesPrice } from "./amm"
import { applyRebate } from "./rebate"

describe("rebate", () => {
  it("moves the quoted price part of the way toward the fill and adds the rebate to TVL", () => {
    const pool = { yes: 1000, no: 1000 }
    const rebate = 100
    const target = 0.7
    const result = applyRebate(pool, rebate, target)
    const expected = 0.5 + (target - 0.5) * (rebate / (rebate + 1000))
    expect(result.priceBefore).toBeCloseTo(0.5, 10)
    expect(result.priceAfter).toBeCloseTo(expected, 8)
    expect(yesPrice(result.pool)).toBeCloseTo(expected, 8)
    expect(markedTvl(result.pool)).toBeCloseTo(1100, 6)
    expect(result.priceAfter).toBeGreaterThan(0.5)
    expect(result.priceAfter).toBeLessThan(target)
  })

  it("leaves the pool alone when the rebate is zero", () => {
    const pool = { yes: 1000, no: 1000 }
    const result = applyRebate(pool, 0, 0.9)
    expect(result.pool).toEqual(pool)
    expect(result.priceAfter).toBeCloseTo(0.5, 10)
  })
})
