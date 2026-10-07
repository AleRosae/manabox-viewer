import type { Card, Entry, Finish, Row } from './types'

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']

/** Market price in EUR for a finish; falls back to USD converted with `usdToEur`. */
export function marketPrice(card: Card, finish: Finish, usdToEur: number): number | null {
  const p = card.prices
  const eur = finish === 'foil' ? p.eur_foil : finish === 'etched' ? (p.eur_etched ?? p.eur_foil) : p.eur
  if (eur != null) return Number(eur)
  const usd = finish === 'foil' ? p.usd_foil : finish === 'etched' ? (p.usd_etched ?? p.usd_foil) : p.usd
  if (usd != null) return Math.round(Number(usd) * usdToEur * 100) / 100
  return null
}

export function isLand(card: Card): boolean {
  // MDFCs like "Instant // Land" count as spells; only the front face decides.
  const front = card.type_line.split(' // ')[0]
  return /\bLand\b/.test(front)
}

export function isDoubleFaced(card: Card): boolean {
  return card.image_faces === 2
}

/** Cube-style color bucket: mono color, M (multicolor), C (colorless non-land), L (land). */
export function colorBucket(card: Card): string {
  if (isLand(card)) return 'L'
  const colors = card.colors ?? []
  if (colors.length === 0) return 'C'
  if (colors.length > 1) return 'M'
  return colors[0]
}

export const BUCKET_LABEL: Record<string, string> = {
  W: 'Bianco',
  U: 'Blu',
  B: 'Nero',
  R: 'Rosso',
  G: 'Verde',
  M: 'Multicolore',
  C: 'Incolore',
  L: 'Terre',
}

export const BUCKET_COLOR: Record<string, string> = {
  W: '#F0E6C8',
  U: '#4A90D9',
  B: '#8A7A94',
  R: '#C9503A',
  G: '#3E8E5E',
  M: '#D9B45A',
  C: '#9AA0AA',
  L: '#8C7B62',
}

export const BUCKET_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L']

export const MAIN_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land']

export function mainTypes(card: Card): string[] {
  const front = card.type_line.split(' // ')[0]
  return MAIN_TYPES.filter((t) => front.includes(t))
}

export function primaryType(card: Card): string {
  const types = mainTypes(card)
  // Creature wins (artifact creatures are creatures for cube purposes), then the first match.
  if (types.includes('Creature')) return 'Creature'
  if (types.includes('Land')) return 'Land'
  return types[0] ?? 'Other'
}

const rowMarket = (row: Row, card: Card, usdToEur: number) => marketPrice(card, row.finish, usdToEur)

/**
 * Builds display entries.
 * - `binder` scope: one entry per CSV row of that binder.
 * - `all` scope: one entry per card (oracle_id) aggregating every printing and binder;
 *   the representative printing is the most valuable one.
 */
export function buildEntries(
  rows: Row[],
  cards: Record<string, Card>,
  scope: string,
  usdToEur: number,
): Entry[] {
  if (scope !== 'all') {
    return rows
      .filter((r) => r.binder_name === scope && r.scryfall_id && cards[r.scryfall_id])
      .map((r) => {
        const card = cards[r.scryfall_id!]
        const unit = rowMarket(r, card, usdToEur)
        return {
          key: `r${r.id}`,
          card,
          rows: [r],
          quantity: r.quantity,
          binders: [r.binder_name],
          foil: r.finish !== 'normal',
          unitMarket: unit,
          unitPurchase: r.purchase_price,
          marketValue: (unit ?? 0) * r.quantity,
          purchaseValue: (r.purchase_price ?? 0) * r.quantity,
          addedAt: r.added_at,
        }
      })
  }

  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.scryfall_id || !cards[r.scryfall_id]) continue
    const oracle = cards[r.scryfall_id].oracle_id
    const list = groups.get(oracle)
    if (list) list.push(r)
    else groups.set(oracle, [r])
  }
  const entries: Entry[] = []
  for (const [oracle, group] of groups) {
    let best = group[0]
    let bestPrice = -1
    let marketValue = 0
    let purchaseValue = 0
    let quantity = 0
    let addedAt: string | null = null
    for (const r of group) {
      const price = rowMarket(r, cards[r.scryfall_id!], usdToEur)
      if ((price ?? 0) > bestPrice) {
        bestPrice = price ?? 0
        best = r
      }
      marketValue += (price ?? 0) * r.quantity
      purchaseValue += (r.purchase_price ?? 0) * r.quantity
      quantity += r.quantity
      if (r.added_at && (!addedAt || r.added_at > addedAt)) addedAt = r.added_at
    }
    const card = cards[best.scryfall_id!]
    entries.push({
      key: `o${oracle}`,
      card,
      rows: group,
      quantity,
      binders: [...new Set(group.map((r) => r.binder_name))].sort(),
      foil: group.some((r) => r.finish !== 'normal'),
      unitMarket: rowMarket(best, card, usdToEur),
      unitPurchase: best.purchase_price,
      marketValue,
      purchaseValue,
      addedAt,
    })
  }
  return entries
}

export interface CollectionIndex {
  /** oracle_id → copies owned across every binder */
  ownedByOracle: Map<string, number>
  /** lowercase name → oracle_id (for the list "add card" search) */
  oracleByName: Map<string, string>
  /** oracle_id → rows */
  rowsByOracle: Map<string, Row[]>
  /** oracle_id → most valuable owned printing id */
  bestPrintByOracle: Map<string, string>
  binders: { name: string; quantity: number }[]
}

export function indexCollection(rows: Row[], cards: Record<string, Card>, usdToEur: number): CollectionIndex {
  const ownedByOracle = new Map<string, number>()
  const oracleByName = new Map<string, string>()
  const rowsByOracle = new Map<string, Row[]>()
  const bestPrintByOracle = new Map<string, string>()
  const bestPrice = new Map<string, number>()
  const binderQty = new Map<string, number>()
  for (const r of rows) {
    binderQty.set(r.binder_name, (binderQty.get(r.binder_name) ?? 0) + r.quantity)
    const card = r.scryfall_id ? cards[r.scryfall_id] : undefined
    if (!card) continue
    const o = card.oracle_id
    ownedByOracle.set(o, (ownedByOracle.get(o) ?? 0) + r.quantity)
    oracleByName.set(card.name.toLowerCase(), o)
    const list = rowsByOracle.get(o)
    if (list) list.push(r)
    else rowsByOracle.set(o, [r])
    const price = marketPrice(card, r.finish, usdToEur) ?? 0
    if (!bestPrintByOracle.has(o) || price > (bestPrice.get(o) ?? 0)) {
      bestPrintByOracle.set(o, card.id)
      bestPrice.set(o, price)
    }
  }
  const binders = [...binderQty.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { ownedByOracle, oracleByName, rowsByOracle, bestPrintByOracle, binders }
}

// --- formatting --------------------------------------------------------------------------------

// Italian locale skips the separator for 4-digit numbers unless grouping is forced.
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' })
const num = new Intl.NumberFormat('it-IT', { useGrouping: 'always' })

export const fmtEur = (v: number | null | undefined) => (v == null ? '—' : eur.format(v))
export const fmtNum = (v: number) => num.format(v)
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
