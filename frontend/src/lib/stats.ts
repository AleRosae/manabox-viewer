import { BUCKET_ORDER, colorBucket, isLand, MAIN_TYPES, mainTypes, RARITY_ORDER } from './cards'
import type { Card } from './types'

/** Input shared by collection and list stats. */
export interface StatItem {
  card: Card
  quantity: number
  unitMarket: number | null
  /** total purchase value of these copies (collection only) */
  purchaseValue: number | null
  foil: boolean
  /** copies per binder (collection only) */
  binderQty?: Record<string, number>
}

export interface Bar {
  key: string
  label: string
  value: number
}

export interface Stats {
  copies: number
  unique: number
  marketValue: number
  purchaseValue: number | null
  missingPrice: number
  foilCopies: number
  sets: number
  colors: Bar[]
  curve: Bar[]
  avgMv: number | null
  rarity: Bar[]
  types: Bar[]
  topSets: Bar[]
  binders: Bar[]
  binderValue: Record<string, number>
  top: StatItem[]
}

export function computeStats(items: StatItem[], topSetCount = 8): Stats {
  let copies = 0
  let marketValue = 0
  let purchaseValue: number | null = null
  let missingPrice = 0
  let foilCopies = 0
  let mvSum = 0
  let mvCount = 0
  const oracles = new Set<string>()
  const colors = new Map<string, number>()
  const curve = new Map<number, number>()
  const rarity = new Map<string, number>()
  const types = new Map<string, number>()
  const sets = new Map<string, { label: string; value: number }>()
  const binders = new Map<string, number>()
  const binderValue: Record<string, number> = {}

  for (const it of items) {
    const { card, quantity: q } = it
    copies += q
    oracles.add(card.oracle_id)
    if (it.unitMarket == null) missingPrice += q
    marketValue += (it.unitMarket ?? 0) * q
    if (it.purchaseValue != null) purchaseValue = (purchaseValue ?? 0) + it.purchaseValue
    if (it.foil) foilCopies += q
    const bucket = colorBucket(card)
    colors.set(bucket, (colors.get(bucket) ?? 0) + q)
    if (!isLand(card)) {
      const mv = Math.min(7, Math.floor(card.cmc))
      curve.set(mv, (curve.get(mv) ?? 0) + q)
      mvSum += card.cmc * q
      mvCount += q
    }
    rarity.set(card.rarity, (rarity.get(card.rarity) ?? 0) + q)
    for (const t of mainTypes(card)) types.set(t, (types.get(t) ?? 0) + q)
    const s = sets.get(card.set) ?? { label: card.set_name, value: 0 }
    s.value += q
    sets.set(card.set, s)
    for (const [b, bq] of Object.entries(it.binderQty ?? {})) {
      binders.set(b, (binders.get(b) ?? 0) + bq)
      binderValue[b] = (binderValue[b] ?? 0) + (it.unitMarket ?? 0) * bq
    }
  }

  return {
    copies,
    unique: oracles.size,
    marketValue,
    purchaseValue,
    missingPrice,
    foilCopies,
    sets: sets.size,
    colors: BUCKET_ORDER.map((k) => ({ key: k, label: k, value: colors.get(k) ?? 0 })),
    curve: Array.from({ length: 8 }, (_, i) => ({ key: String(i), label: i === 7 ? '7+' : String(i), value: curve.get(i) ?? 0 })),
    avgMv: mvCount ? mvSum / mvCount : null,
    rarity: RARITY_ORDER.filter((r) => rarity.has(r)).map((r) => ({ key: r, label: r, value: rarity.get(r)! })),
    types: MAIN_TYPES.filter((t) => types.has(t)).map((t) => ({ key: t, label: t, value: types.get(t)! })),
    topSets: [...sets.entries()]
      .map(([key, s]) => ({ key, label: s.label, value: s.value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, topSetCount),
    binders: [...binders.entries()].map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value),
    binderValue,
    top: [...items]
      .filter((i) => i.unitMarket != null)
      .sort((a, b) => (b.unitMarket ?? 0) - (a.unitMarket ?? 0))
      .slice(0, 10),
  }
}
