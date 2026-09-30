export type UserId = "trader1" | "trader2" | "lp"

export type Asset = "YES" | "NO"

export type Side = "buy" | "sell"

export type FillStatus = "pending" | "finalized" | "replaced"

export interface Params {
  windowMs: number
  /** Fraction of the fill price. 0.02 means the next price must be 2% better. */
  minOutbid: number
  /** Fraction of the price gap paid to the displaced trader. */
  traderShare: number
}

export interface Pool {
  yes: number
  no: number
}

export interface Balances {
  usdc: number
  YES: number
  NO: number
}

export interface Fill {
  id: string
  owner: UserId
  side: Side
  asset: Asset
  shares: number
  /** USDC per share the current holder locked. */
  price: number
  deadline: number
  createdAt: number
  status: FillStatus
  replacedBy?: UserId
  /** USDC credited when this slice was replaced. */
  payoutUsdc?: number
  profitUsdc?: number
  /** Outcome tokens returned to a displaced seller. */
  returnedShares?: number
  replacedAt?: number
  finalizedAt?: number
}

export interface Activity {
  id: string
  time: number
  kind: "rebate" | "finalize"
  text: string
  priceBefore?: number
  priceAfter?: number
  rebate?: number
}

export interface MarketState {
  pool: Pool
  balances: Record<UserId, Balances>
  fills: Fill[]
  activity: Activity[]
  rebates: number
  params: Params
  marketTime: number
  speed: number
  activeUser: UserId
  nextId: number
}

export interface SwapInput {
  user: UserId
  side: Side
  asset: Asset
  /** USDC when buying, outcome shares when selling. */
  amount: number
  improvePrice?: number
}

export type Result =
  | { ok: true; state: MarketState }
  | { ok: false; error: string }
