import { isDoubleFaced, mainTypes, RARITY_ORDER } from './cards'
import type { Entry } from './types'

export type ColorMode = 'include' | 'atmost' | 'exact'

/** Structured filters from the sidebar; combined (AND) with the text query. */
export interface PanelFilters {
  colors: string[] // W U B R G C
  colorMode: ColorMode
  types: string[]
  rarities: string[]
  sets: string[]
  mvMin: number | null
  mvMax: number | null
  priceMin: number | null
  priceMax: number | null
  foilOnly: boolean
  dfcOnly: boolean
}

export const EMPTY_FILTERS: PanelFilters = {
  colors: [],
  colorMode: 'include',
  types: [],
  rarities: [],
  sets: [],
  mvMin: null,
  mvMax: null,
  priceMin: null,
  priceMax: null,
  foilOnly: false,
  dfcOnly: false,
}

export function activeFilterCount(f: PanelFilters): number {
  return (
    (f.colors.length ? 1 : 0) +
    (f.types.length ? 1 : 0) +
    (f.rarities.length ? 1 : 0) +
    (f.sets.length ? 1 : 0) +
    (f.mvMin != null || f.mvMax != null ? 1 : 0) +
    (f.priceMin != null || f.priceMax != null ? 1 : 0) +
    (f.foilOnly ? 1 : 0) +
    (f.dfcOnly ? 1 : 0)
  )
}

function colorsMatch(cardColors: string[], selected: string[], mode: ColorMode): boolean {
  const wantColorless = selected.includes('C')
  const want = selected.filter((c) => c !== 'C')
  const have = cardColors
  if (have.length === 0) return wantColorless || mode === 'atmost'
  if (want.length === 0) return false // only colorless selected
  switch (mode) {
    case 'include':
      return want.every((c) => have.includes(c))
    case 'atmost':
      return have.every((c) => want.includes(c))
    case 'exact':
      return have.length === want.length && want.every((c) => have.includes(c))
  }
}

export function matchesPanel(e: Entry, f: PanelFilters): boolean {
  const card = e.card
  if (f.colors.length && !colorsMatch(card.colors ?? [], f.colors, f.colorMode)) return false
  if (f.types.length) {
    const types = mainTypes(card)
    if (!f.types.some((t) => types.includes(t))) return false
  }
  if (f.rarities.length && !f.rarities.includes(card.rarity)) return false
  if (f.sets.length && !e.rows.some((r) => f.sets.includes(r.set_code.toLowerCase()))) return false
  if (f.mvMin != null && card.cmc < f.mvMin) return false
  if (f.mvMax != null && card.cmc > f.mvMax) return false
  if (f.priceMin != null && (e.unitMarket ?? 0) < f.priceMin) return false
  if (f.priceMax != null && (e.unitMarket ?? 0) > f.priceMax) return false
  if (f.foilOnly && !e.foil) return false
  if (f.dfcOnly && !isDoubleFaced(card)) return false
  return true
}

// --- sorting ---------------------------------------------------------------------------------

export type SortKey = 'name' | 'mv' | 'price' | 'value' | 'rarity' | 'set' | 'added' | 'color' | 'qty'
export type SortDir = 'asc' | 'desc'

export const SORT_LABELS: Record<SortKey, string> = {
  price: 'Price',
  value: 'Total value',
  name: 'Name',
  mv: 'Mana value',
  color: 'Color',
  rarity: 'Rarity',
  set: 'Set',
  qty: 'Copies',
  added: 'Date added',
}

const colorRank = (colors: string[]) => {
  if (colors.length === 0) return 6
  if (colors.length > 1) return 5
  return 'WUBRG'.indexOf(colors[0])
}

export function sortEntries(entries: Entry[], key: SortKey, dir: SortDir): Entry[] {
  const sign = dir === 'asc' ? 1 : -1
  const byName = (a: Entry, b: Entry) => a.card.name.localeCompare(b.card.name)
  const value = (e: Entry): number | string => {
    switch (key) {
      case 'name':
        return e.card.name
      case 'mv':
        return e.card.cmc
      case 'price':
        return e.unitMarket ?? -1
      case 'value':
        return e.marketValue
      case 'rarity':
        return RARITY_ORDER.indexOf(e.card.rarity)
      case 'set':
        return e.card.released_at ?? ''
      case 'added':
        return e.addedAt ?? ''
      case 'color':
        return colorRank(e.card.colors ?? [])
      case 'qty':
        return e.quantity
    }
  }
  return [...entries].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return cmp !== 0 ? cmp * sign : byName(a, b)
  })
}
