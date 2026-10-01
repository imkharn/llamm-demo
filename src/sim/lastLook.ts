import { SWAP_FEE, poolActions, quoteSwap, yesPrice } from "./amm"
import { formatCentsMove, formatShares, formatUsdc, userLabel } from "./format"
import { applyRebate } from "./rebate"
import type {
  Activity,
  Asset,
  Balances,
  Fill,
  MarketState,
  Result,
  Side,
  SwapInput,
  UserId,
} from "./types"

export const WINDOW_MS = 2 * 60 * 60 * 1000
const PRICE_EPS = 1e-4
/** Near the full size counts as the whole fill, so a rounded input does not leave a dust remainder. */
const SHARE_EPS = 0.005

export interface RouteLeg {
  source: "last-look" | "pool"
  shares: number
  usdc: number
  price: number
  fee: number
}

export interface SwapPreview {
  side: Side
  asset: Asset
  usdc: number
  shares: number
  price: number
  spotBefore: number
  spotAfter: number
  /** Execution versus the mid, as a fraction. Negative means a better price than the pool mid. */
  priceImpact: number
  /** Lowest buy, or highest sell, that is 2% better than every slice of this trade. */
  overpayAt: number
  /** Swap fee charged on the pool leg. Last-look matches are not charged. */
  fee: number
  legs: RouteLeg[]
  improve: ImprovePreview | null
}

export interface ImprovePreview {
  newPrice: number
  gap: number
  profit: number
  rebate: number
  netExtraUsdc: number
  priceBefore: number
  priceAfter: number
}

export interface OutbidPreview {
  fill: Fill
  q: number
  newPrice: number
  gap: number
  profit: number
  rebate: number
  same: boolean
  payoutUsdc: number
  returnedShares: number
  youPayUsdc: number
  youPayShares: number
  youReceiveUsdc: number
  youReceiveShares: number
  priceBefore: number
  priceAfter: number
  split: boolean
  remainderShares: number
  newDeadline: number
}

interface OutbidPlan {
  preview: OutbidPreview
  pool: MarketState["pool"]
}

export function initialState(): MarketState {
  const empty = (): Balances => ({ usdc: 0, YES: 0, NO: 0 })
  return {
    pool: { yes: 1000, no: 1000 },
    balances: {
      trader1: { usdc: 1000, YES: 0, NO: 0 },
      trader2: { usdc: 1000, YES: 0, NO: 0 },
      lp: empty(),
    },
    fills: [],
    activity: [],
    rebates: 0,
    params: { windowMs: WINDOW_MS, minOutbid: 0.02, traderShare: 0.1 },
    marketTime: 0,
    speed: 0,
    activeUser: "trader1",
    nextId: 1,
  }
}

export function sanitizeParams(params: MarketState["params"]): MarketState["params"] {
  return {
    windowMs: clamp(params.windowMs, 60_000, 48 * 3600_000),
    minOutbid: clamp(params.minOutbid, 0.0001, 0.5),
    traderShare: clamp(params.traderShare, 0, 1),
  }
}

export function escrowNotional(fills: Fill[]): number {
  return fills
    .filter((fill) => fill.status === "pending")
    .reduce((sum, fill) => sum + fill.price * fill.shares, 0)
}

export function lastLookChance(fills: Fill[]): number | null {
  let weight = 0
  let sum = 0
  for (const fill of fills) {
    if (fill.status !== "pending" || !(fill.shares > 0)) continue
    const yes = fill.asset === "YES" ? fill.price : 1 - fill.price
    sum += yes * fill.shares
    weight += fill.shares
  }
  return weight > 0 ? sum / weight : null
}

export function routeLabel(legs: RouteLeg[], asset: Asset): string {
  const look = legs.filter((leg) => leg.source === "last-look").reduce((sum, leg) => sum + leg.shares, 0)
  const pool = legs.filter((leg) => leg.source === "pool").reduce((sum, leg) => sum + leg.shares, 0)
  if (look > 0 && pool > 0) return `Last look ${formatShares(look)} ${asset} · Pool ${formatShares(pool)} ${asset}`
  if (look > 0) return "Last look"
  return "Pool"
}

export function describeSwap(
  state: MarketState,
  input: SwapInput,
): { ok: true; preview: SwapPreview } | { ok: false; error: string } {
  const sim = simulateSwap(state, input)
  if (!sim.ok) return sim
  return { ok: true, preview: previewFrom(state, input, sim) }
}

/**
 * Largest route size whose all-in USDC, including an overpay, stays within `budgetUsdc`.
 * Returns the requested amount when the price is not a valid overpay.
 */
export function fitSwapAmount(state: MarketState, input: SwapInput, budgetUsdc: number): number {
  if (!(input.amount > 0) || input.side !== "buy" || input.improvePrice == null || !Number.isFinite(input.improvePrice)) {
    return input.amount
  }
  const spent = (amount: number): number | null => {
    if (!(amount > 1e-8)) return null
    const described = describeSwap(state, { ...input, amount })
    if (!described.ok) return null
    return amount + (described.preview.improve?.netExtraUsdc ?? 0)
  }
  const full = spent(input.amount)
  if (full != null && full <= budgetUsdc + 1e-6) return input.amount
  const probed = describeSwap(state, input)
  if (!probed.ok && !probed.error.startsWith("Insufficient")) return input.amount

  let lo = 0
  let hi = input.amount
  let best = 0
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const cost = spent(mid)
    if (cost != null && cost <= budgetUsdc + 1e-6) {
      best = mid
      lo = mid
    } else hi = mid
  }
  return best > 0 ? best : input.amount
}

export function applySwap(state: MarketState, input: SwapInput): Result {
  const sim = simulateSwap(state, input)
  if (!sim.ok) return sim
  return { ok: true, state: sim.state }
}

interface Simulation {
  state: MarketState
  legs: RouteLeg[]
  improve: ImprovePreview | null
}

function simulateSwap(state: MarketState, input: SwapInput): { ok: true } & Simulation | { ok: false; error: string } {
  if (input.user === "lp") return { ok: false, error: "Switch to a trader to swap." }
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return { ok: false, error: "Enter an amount." }
  if (input.improvePrice != null && !(input.improvePrice >= 0)) return { ok: false, error: "Enter a price." }

  let working = state
  const legs: RouteLeg[] = []
  const created: string[] = []
  let left = input.amount

  for (let step = 0; step < 24; step++) {
    const dust = input.side === "buy" ? left <= 1e-6 : left <= SHARE_EPS
    if (dust) break
    const quote = quoteSwap(working.pool, input.side, input.asset, left)
    const ammPrice = quote ? quote.price : relevantSpot(working, input.asset)
    const candidate = bestLook(working, input.user, input.side, input.asset, ammPrice)
    if (candidate) {
      const bound = replacementBound(candidate, working.params.minOutbid)
      const q =
        input.side === "buy"
          ? bound * candidate.shares <= left + 1e-8
            ? candidate.shares
            : left / bound
          : Math.min(candidate.shares, left)
      if (q > SHARE_EPS) {
        const taken = takeLook(working, input.user, candidate, bound, q)
        if (!taken.ok) return taken
        working = taken.state
        legs.push(taken.leg)
        created.push(taken.fillId)
        left -= input.side === "buy" ? taken.leg.usdc : taken.leg.shares
        continue
      }
    }
    if (!quote) return { ok: false, error: "The pool cannot fill this amount." }
    const filled = applyAmmFill(working, { ...input, amount: left })
    if (!filled.ok) return filled
    working = filled.state
    legs.push(filled.leg)
    created.push(filled.fillId)
    left = 0
  }

  if (legs.length === 0) return { ok: false, error: "The pool cannot fill this amount." }

  let improve: ImprovePreview | null = null
  if (input.improvePrice != null) {
    const raised = raiseFills(working, input.user, created, input.improvePrice)
    if (!raised.ok) return raised
    working = raised.state
    improve = raised.improve
  }

  return { ok: true, state: working, legs, improve }
}

function previewFrom(state: MarketState, input: SwapInput, sim: Simulation): SwapPreview {
  const shares = sim.legs.reduce((sum, leg) => sum + leg.shares, 0)
  const acquiredUsdc = sim.legs.reduce((sum, leg) => sum + leg.usdc, 0)
  const acquired = shares > 0 ? acquiredUsdc / shares : 0
  const price = sim.improve ? sim.improve.newPrice : acquired
  const mid = relevantSpot(state, input.asset)
  const priceImpact = mid > 1e-12 ? (input.side === "buy" ? (price - mid) / mid : (mid - price) / mid) : 0
  const strict = sim.legs.reduce((bound, leg) => {
    const next = replacementBound({ side: input.side, price: leg.price }, state.params.minOutbid)
    if (input.side === "buy") return Math.max(bound, next)
    return Math.min(bound, next)
  }, input.side === "buy" ? 0 : 1)
  return {
    side: input.side,
    asset: input.asset,
    usdc: input.side === "sell" && sim.improve ? sim.improve.newPrice * shares : acquiredUsdc,
    shares,
    price,
    spotBefore: yesPrice(state.pool),
    spotAfter: yesPrice(sim.state.pool),
    priceImpact,
    overpayAt: strict,
    fee: sim.legs.reduce((sum, leg) => sum + leg.fee, 0),
    legs: sim.legs,
    improve: sim.improve,
  }
}

/** Input amount (USDC when buying, shares when selling) that delivers `output`. */
export function quoteInput(
  state: MarketState,
  input: { user: UserId; side: Side; asset: Asset; output: number },
): number | null {
  if (!(input.output > 0) || !Number.isFinite(input.output)) return null
  const rich: MarketState = {
    ...state,
    balances: {
      ...state.balances,
      [input.user]: { usdc: 1e12, YES: 1e12, NO: 1e12 },
    },
  }
  const probe = (amount: number): number | null => {
    const described = describeSwap(rich, {
      user: input.user,
      side: input.side,
      asset: input.asset,
      amount,
    })
    if (!described.ok) return null
    return input.side === "buy" ? described.preview.shares : described.preview.usdc
  }
  let lo = 0
  let hi = input.side === "buy" ? input.output / (1 - SWAP_FEE) : Math.max(input.output, 1)
  let reached = probe(hi)
  for (let i = 0; i < 24 && (reached == null || reached < input.output); i++) {
    if (reached == null && i > 0) return null
    hi *= 2
    if (hi > 1e12) return null
    reached = probe(hi)
  }
  if (reached == null || reached < input.output) return null
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const got = probe(mid)
    if (got != null && got < input.output) lo = mid
    else hi = mid
  }
  return hi
}

export function swapActions(preview: SwapPreview): string[] {
  const steps: string[] = []
  let lookShares = 0
  const flushLook = () => {
    if (lookShares <= 0) return
    steps.push(`Match ${formatShares(lookShares)} ${preview.asset} from a last look`)
    lookShares = 0
  }
  for (const leg of preview.legs) {
    if (leg.source === "last-look") {
      lookShares += leg.shares
      continue
    }
    flushLook()
    steps.push(...poolActions(preview.asset, preview.side, leg.shares, leg.usdc, leg.fee))
  }
  flushLook()
  return steps
}

/** Price the new trader locked, and pool rebate revenue before and after that bid. */
export function orderEconomics(
  event: Fill,
  fills: Fill[],
  activity: Activity[],
  traderShare: number,
): { nextPrice: number; revenueBefore: number; revenueAfter: number } {
  const nextPrice = resolveNextPrice(event, fills, traderShare)
  if (event.revenueBefore != null && event.revenueAfter != null) {
    return { nextPrice, revenueBefore: event.revenueBefore, revenueAfter: event.revenueAfter }
  }
  let recorded: number | undefined
  let revenueBefore = 0
  for (const item of activity) {
    if (item.kind !== "rebate") continue
    if (item.fillId === event.id) {
      recorded = item.rebate
      break
    }
    if (event.replacedAt != null && item.time > event.replacedAt) break
    if (event.replacedAt != null && item.time === event.replacedAt && item.fillId == null) {
      recorded = item.rebate
      break
    }
    revenueBefore += item.rebate ?? 0
  }
  const rebate =
    event.rebateUsdc ??
    recorded ??
    (traderShare > 0 && traderShare < 1 ? ((event.profitUsdc ?? 0) * (1 - traderShare)) / traderShare : 0)
  return { nextPrice, revenueBefore, revenueAfter: revenueBefore + rebate }
}

function resolveNextPrice(event: Fill, fills: Fill[], traderShare: number): number {
  if (event.nextPrice != null && Number.isFinite(event.nextPrice)) return event.nextPrice
  const successor = event.successorId ? fills.find((item) => item.id === event.successorId) : undefined
  if (successor && Math.abs(successor.shares - event.shares) <= Math.max(0.01, event.shares * 1e-4)) {
    return successor.price
  }
  if (traderShare > 0 && event.shares > 0) {
    const gap = (event.profitUsdc ?? 0) / (traderShare * event.shares)
    return event.side === "buy" ? event.price + gap : Math.max(0, event.price - gap)
  }
  return event.price
}

/** Follow replacements to the order that is still open or already finalized. */
export function liveHead(fill: Fill, fills: Fill[]): Fill {
  let current = fill
  const seen = new Set<string>()
  while (current.successorId && !seen.has(current.id)) {
    seen.add(current.id)
    const next = fills.find((item) => item.id === current.successorId)
    if (!next) break
    current = next
  }
  return current
}

export interface DisplacementStory {
  displaced: Fill
  nextPrice: number
  rebate: number
}

/** The other trader this order took, skipping a later raise of the buyer's own fill. */
export function displacementStory(fill: Fill, fills: Fill[], traderShare = 0.1): DisplacementStory | null {
  const immediate = fill.status === "replaced" ? fill : fill.replacesId ? fills.find((item) => item.id === fill.replacesId) : undefined
  if (!immediate) return null
  const displaced = rootDisplacement(immediate, fills)
  const head = liveHead(displaced, fills)
  return { displaced, nextPrice: head.price, rebate: chainRebate(displaced, fills, traderShare) }
}

function rootDisplacement(event: Fill, fills: Fill[]): Fill {
  let current = event
  const seen = new Set<string>()
  while (current.replacedBy === current.owner && !seen.has(current.id)) {
    seen.add(current.id)
    const linked = current.replacesId ? fills.find((item) => item.id === current.replacesId) : undefined
    const pointed = fills.find((item) => item.successorId === current.id && item.id !== current.id)
    const prev = linked ?? pointed
    if (!prev) break
    current = prev
  }
  return current
}

function chainRebate(root: Fill, fills: Fill[], traderShare: number): number {
  let total = 0
  let current: Fill | undefined = root
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.status === "replaced") {
      if (current.rebateUsdc != null) total += current.rebateUsdc
      else if (traderShare > 0 && traderShare < 1) total += ((current.profitUsdc ?? 0) * (1 - traderShare)) / traderShare
    }
    const nextId: string | undefined = current.successorId
    if (!nextId) break
    current = fills.find((item) => item.id === nextId)
  }
  return total
}

function bestLook(state: MarketState, actor: UserId, side: Side, asset: Asset, ammPrice: number): Fill | undefined {
  const options = state.fills.filter((fill) => {
    if (fill.status !== "pending" || fill.owner === actor || fill.side !== side || fill.asset !== asset) return false
    if (outbidBlockedReason(fill, state.params)) return false
    const bound = replacementBound(fill, state.params.minOutbid)
    return side === "buy" ? bound < ammPrice - 1e-8 : bound > ammPrice + 1e-8
  })
  options.sort((a, b) => {
    const diff = replacementBound(a, state.params.minOutbid) - replacementBound(b, state.params.minOutbid)
    if (Math.abs(diff) > 1e-12) return side === "buy" ? diff : -diff
    return a.createdAt - b.createdAt
  })
  return options[0]
}

function takeLook(
  state: MarketState,
  actor: UserId,
  fill: Fill,
  price: number,
  shares: number,
): { ok: true; state: MarketState; leg: RouteLeg; fillId: string } | { ok: false; error: string } {
  const before = state
  const out = applyOutbid(state, actor, fill.id, price, shares)
  if (!out.ok) return out
  const created = out.state.fills.find(
    (item) => item.status === "pending" && item.owner === actor && !before.fills.some((old) => old.id === item.id),
  )
  if (!created) return { ok: false, error: "Could not match that last look." }
  return {
    ok: true,
    state: out.state,
    fillId: created.id,
    leg: {
      source: "last-look",
      shares: created.shares,
      usdc: created.price * created.shares,
      price: created.price,
      fee: 0,
    },
  }
}

function applyAmmFill(
  state: MarketState,
  input: SwapInput,
): { ok: true; state: MarketState; leg: RouteLeg; fillId: string } | { ok: false; error: string } {
  const quote = quoteSwap(state.pool, input.side, input.asset, input.amount)
  if (!quote) return { ok: false, error: "The pool cannot fill this amount." }
  const balanceError = affordSwap(state, input.user, input.side, input.asset, quote.usdc, quote.shares)
  if (balanceError) return { ok: false, error: balanceError }

  const balances = copyBalances(state.balances)
  if (input.side === "buy") balances[input.user].usdc -= quote.usdc
  else balances[input.user][input.asset] -= quote.shares
  balances.lp.usdc += quote.fee

  const fillId = `f${state.nextId}`
  const fill: Fill = {
    id: fillId,
    owner: input.user,
    side: input.side,
    asset: input.asset,
    shares: quote.shares,
    price: quote.price,
    feeUsdc: quote.fee,
    deadline: state.marketTime + state.params.windowMs,
    createdAt: state.marketTime,
    status: "pending",
  }
  return {
    ok: true,
    fillId,
    leg: { source: "pool", shares: quote.shares, usdc: quote.usdc, price: quote.price, fee: quote.fee },
    state: {
      ...state,
      pool: quote.pool,
      balances,
      fills: [...state.fills, fill],
      nextId: state.nextId + 1,
    },
  }
}

function raiseFills(
  state: MarketState,
  actor: UserId,
  fillIds: string[],
  newPrice: number,
): { ok: true; state: MarketState; improve: ImprovePreview } | { ok: false; error: string } {
  let working = state
  let profit = 0
  let rebate = 0
  let netExtraUsdc = 0
  let gap = 0
  let priceBefore = yesPrice(working.pool)
  let priceAfter = priceBefore
  let first = true
  for (const id of fillIds) {
    const fill = working.fills.find((item) => item.id === id && item.status === "pending")
    if (!fill) continue
    const described = describeOutbid(working, actor, id, newPrice, fill.shares)
    if (!described.ok) return described
    const applied = applyOutbid(working, actor, id, newPrice, fill.shares)
    if (!applied.ok) return applied
    if (first) {
      priceBefore = described.preview.priceBefore
      first = false
    }
    profit += described.preview.profit
    rebate += described.preview.rebate
    gap += described.preview.gap * described.preview.q
    netExtraUsdc += described.preview.youPayUsdc
    priceAfter = described.preview.priceAfter
    working = applied.state
  }
  return {
    ok: true,
    state: working,
    improve: { newPrice, gap, profit, rebate, netExtraUsdc, priceBefore, priceAfter },
  }
}

export function describeOutbid(
  state: MarketState,
  actor: UserId,
  fillId: string,
  newPrice: number,
  shares: number,
): { ok: true; preview: OutbidPreview } | { ok: false; error: string } {
  const planned = planOutbid(state, actor, fillId, newPrice, shares)
  if (!planned.ok) return planned
  return { ok: true, preview: planned.plan.preview }
}

export function applyOutbid(
  state: MarketState,
  actor: UserId,
  fillId: string,
  newPrice: number,
  shares: number,
): Result {
  const planned = planOutbid(state, actor, fillId, newPrice, shares)
  if (!planned.ok) return planned
  const fill = state.fills.find((item) => item.id === fillId)
  if (!fill) return { ok: false, error: "Last look not found." }

  const { preview, pool } = planned.plan
  const balances = copyBalances(state.balances)
  if (fill.side === "buy") {
    if (preview.same) balances[actor].usdc -= preview.youPayUsdc
    else {
      balances[actor].usdc -= preview.youPayUsdc
      balances[fill.owner].usdc += preview.payoutUsdc
    }
  } else if (!preview.same) {
    balances[actor][fill.asset] -= preview.youPayShares
    balances[fill.owner][fill.asset] += preview.returnedShares
    balances[fill.owner].usdc += preview.profit
  } else {
    balances[actor].usdc += preview.profit
  }

  const createdId = `f${state.nextId}`
  let nextId = state.nextId + 1
  const replacedId = preview.split ? `f${nextId}` : fill.id
  if (preview.split) nextId += 1

  const replaced: Fill = {
    id: replacedId,
    owner: fill.owner,
    side: fill.side,
    asset: fill.asset,
    shares: preview.q,
    price: fill.price,
    deadline: fill.deadline,
    createdAt: fill.createdAt,
    status: "replaced",
    replacedBy: actor,
    payoutUsdc: preview.payoutUsdc,
    profitUsdc: preview.profit,
    returnedShares: preview.returnedShares,
    rebateUsdc: preview.rebate,
    priceBefore: preview.priceBefore,
    priceAfter: preview.priceAfter,
    nextPrice: preview.newPrice,
    revenueBefore: state.rebates,
    revenueAfter: state.rebates + preview.rebate,
    successorId: createdId,
    replacesId: fill.replacesId,
    feeUsdc: preview.split ? undefined : fill.feeUsdc,
    replacedAt: state.marketTime,
  }
  const created: Fill = {
    id: createdId,
    owner: actor,
    side: fill.side,
    asset: fill.asset,
    shares: preview.q,
    price: preview.newPrice,
    deadline: preview.newDeadline,
    createdAt: state.marketTime,
    status: "pending",
    replacesId: replacedId,
  }

  let fills: Fill[]
  if (preview.split) {
    fills = state.fills.map((item) =>
      item.id === fill.id ? { ...item, shares: preview.remainderShares } : item,
    )
    fills = [...fills, replaced, created]
  } else {
    fills = state.fills.map((item) => (item.id === fill.id ? replaced : item))
    fills = [...fills, created]
  }

  const activity = pushActivity(state, {
    id: `a${nextId}`,
    time: state.marketTime,
    kind: "rebate",
    rebate: preview.rebate,
    priceBefore: preview.priceBefore,
    priceAfter: preview.priceAfter,
    fillId: replacedId,
    text: rebateText(actor, fill, preview),
  })
  nextId += 1

  return {
    ok: true,
    state: {
      ...state,
      pool,
      balances,
      fills,
      activity,
      rebates: state.rebates + preview.rebate,
      nextId,
    },
  }
}

export function finalizeDue(state: MarketState): MarketState {
  const due = state.fills.filter((fill) => fill.status === "pending" && fill.deadline <= state.marketTime)
  if (due.length === 0) return state

  const balances = copyBalances(state.balances)
  const done = new Set(due.map((fill) => fill.id))
  let nextId = state.nextId
  let activity = state.activity
  for (const fill of due) {
    if (fill.side === "buy") balances[fill.owner][fill.asset] += fill.shares
    else balances[fill.owner].usdc += fill.price * fill.shares
    const item: Activity = {
      id: `a${nextId}`,
      time: state.marketTime,
      kind: "finalize",
      fillId: fill.id,
      text:
        fill.side === "buy"
          ? `${userLabel(fill.owner)} received ${formatShares(fill.shares)} ${fill.asset} from escrow.`
          : `${userLabel(fill.owner)} received ${formatUsdc(fill.price * fill.shares)} from escrow.`,
    }
    nextId += 1
    activity = [...activity, item].slice(-100)
  }

  return {
    ...state,
    balances,
    nextId,
    activity,
    fills: state.fills.map((fill) =>
      done.has(fill.id) ? { ...fill, status: "finalized", finalizedAt: state.marketTime } : fill,
    ),
  }
}

export function outbidBlockedReason(fill: Fill, params: MarketState["params"]): string | null {
  if (fill.status !== "pending") return "This last look is no longer open."
  if (fill.side === "buy") {
    if (fill.price * (1 + params.minOutbid) >= 1 - 1e-9) {
      return "This buy is already too close to 100¢ to outbid."
    }
  } else if (!(fill.price * (1 - params.minOutbid) < fill.price - 1e-12)) {
    return "This sell is already at the floor."
  }
  return null
}

function planOutbid(
  state: MarketState,
  actor: UserId,
  fillId: string,
  newPrice: number,
  shares: number,
): { ok: true; plan: OutbidPlan } | { ok: false; error: string } {
  if (actor === "lp") return { ok: false, error: "The liquidity provider does not trade." }
  const fill = state.fills.find((item) => item.id === fillId)
  if (!fill) return { ok: false, error: "Last look not found." }
  if (fill.status !== "pending") return { ok: false, error: "This last look is no longer open." }
  if (!Number.isFinite(newPrice) || !Number.isFinite(shares)) {
    return { ok: false, error: "Enter a price and a size." }
  }
  const q = shares >= fill.shares - SHARE_EPS ? fill.shares : shares
  if (!(q > SHARE_EPS)) return { ok: false, error: "Enter a size." }
  if (q > fill.shares + SHARE_EPS) return { ok: false, error: "Size is larger than the fill." }

  const bound = priceError(fill, newPrice, state.params.minOutbid)
  if (bound) return { ok: false, error: bound }

  const gap = Math.abs(newPrice - fill.price)
  const profit = state.params.traderShare * gap * q
  const rebate = (1 - state.params.traderShare) * gap * q
  const same = actor === fill.owner
  const youPayUsdc = fill.side === "buy" ? (same ? rebate : newPrice * q) : 0
  const youPayShares = fill.side === "sell" && !same ? q : 0

  if (youPayUsdc > 0 && state.balances[actor].usdc < youPayUsdc - 1e-6) {
    return { ok: false, error: "Insufficient USDC." }
  }
  if (youPayShares > 0 && state.balances[actor][fill.asset] < youPayShares - 1e-6) {
    return { ok: false, error: `Insufficient ${fill.asset}.` }
  }

  const target = fill.asset === "YES" ? newPrice : 1 - newPrice
  const rebated = applyRebate(state.pool, rebate, target)
  const payoutUsdc = fill.side === "buy" ? (same ? profit : fill.price * q + profit) : profit
  const returnedShares = fill.side === "sell" && !same ? q : 0
  const split = q < fill.shares - SHARE_EPS

  return {
    ok: true,
    plan: {
      pool: rebated.pool,
      preview: {
        fill,
        q,
        newPrice,
        gap,
        profit,
        rebate,
        same,
        payoutUsdc,
        returnedShares,
        youPayUsdc,
        youPayShares,
        youReceiveUsdc: fill.side === "sell" ? newPrice * q : 0,
        youReceiveShares: fill.side === "buy" ? q : 0,
        priceBefore: rebated.priceBefore,
        priceAfter: rebated.priceAfter,
        split,
        remainderShares: fill.shares - q,
        newDeadline: state.marketTime + state.params.windowMs,
      },
    },
  }
}

function replacementBound(fill: Pick<Fill, "side" | "price">, minOutbid: number): number {
  return fill.side === "buy" ? fill.price * (1 + minOutbid) : fill.price * (1 - minOutbid)
}

function priceError(fill: Fill, newPrice: number, minOutbid: number): string | null {
  if (fill.side === "buy") {
    const min = replacementBound(fill, minOutbid)
    if (min >= 1 - 1e-9) return "This buy is already too close to 100¢ to outbid."
    if (newPrice >= 1 - 1e-9) return "A buy cannot be priced at 100¢ or above."
    if (newPrice < min - PRICE_EPS) return `Price must be at least ${(min * 100).toFixed(2)}¢.`
    return null
  }
  const max = replacementBound(fill, minOutbid)
  if (!(max < fill.price - 1e-12)) return "This sell is already at the floor."
  if (newPrice < -PRICE_EPS) return "Price cannot be below 0¢."
  if (newPrice > max + PRICE_EPS) return `Price must be at most ${Math.max(0, max * 100).toFixed(2)}¢.`
  return null
}

function affordSwap(
  state: MarketState,
  user: UserId,
  side: Side,
  asset: Asset,
  usdc: number,
  shares: number,
): string | null {
  const balance = state.balances[user]
  if (side === "buy" && balance.usdc < usdc - 1e-8) return "Insufficient USDC."
  if (side === "sell" && balance[asset] < shares - 1e-8) return `Insufficient ${asset}.`
  return null
}

function rebateText(actor: UserId, fill: Fill, preview: OutbidPreview): string {
  const move = formatCentsMove(preview.priceBefore, preview.priceAfter)
  const rebate = formatUsdc(preview.rebate)
  if (preview.same) {
    return `${userLabel(actor)} improved their own ${fill.asset} ${fill.side}. Rebate ${rebate}. YES price ${move}.`
  }
  return `${userLabel(actor)} replaced ${userLabel(fill.owner)}. Rebate ${rebate}. YES price ${move}.`
}

function pushActivity(state: MarketState, item: Activity): Activity[] {
  return [...state.activity, item].slice(-100)
}

function copyBalances(balances: MarketState["balances"]): MarketState["balances"] {
  return {
    trader1: { ...balances.trader1 },
    trader2: { ...balances.trader2 },
    lp: { ...balances.lp },
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function relevantSpot(state: MarketState, asset: Asset): number {
  const yes = yesPrice(state.pool)
  return asset === "YES" ? yes : 1 - yes
}
