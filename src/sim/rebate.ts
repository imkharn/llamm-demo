import { markedTvl, yesPrice } from "./amm"
import type { Pool } from "./types"

export interface RebateResult {
  pool: Pool
  priceBefore: number
  priceAfter: number
}

/**
 * Isolated on purpose. The rebate is added to marked pool value, and the
 * quoted YES price moves toward the new fill by rebate / (rebate + TVL).
 */
export function applyRebate(pool: Pool, rebateUsd: number, targetYesPrice: number): RebateResult {
  const priceBefore = yesPrice(pool)
  const tvl = markedTvl(pool)
  if (!(rebateUsd > 1e-12) || !(tvl > 0)) {
    return { pool, priceBefore, priceAfter: priceBefore }
  }
  const weight = rebateUsd / (rebateUsd + tvl)
  const target = clamp(targetYesPrice, 1e-6, 1 - 1e-6)
  const priceAfter = clamp(priceBefore + (target - priceBefore) * weight, 1e-6, 1 - 1e-6)
  return {
    pool: reservesFor(priceAfter, tvl + rebateUsd),
    priceBefore,
    priceAfter,
  }
}

function reservesFor(price: number, tvl: number): Pool {
  const sum = tvl / (2 * price * (1 - price))
  return { yes: (1 - price) * sum, no: price * sum }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
