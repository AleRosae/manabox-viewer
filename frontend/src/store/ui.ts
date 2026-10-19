import { create } from 'zustand'
import { defaultThenBy, GROUP_LABEL, type GroupBy, type ThenBy, thenByOptions } from '../lib/listGroups'
import type { Card, ListKind, MoxfieldDeck } from '../lib/types'

interface HoverState {
  card: Card | null
  dimmed: boolean
  x: number
  y: number
  show: (card: Card, x: number, y: number, dimmed?: boolean) => void
  move: (x: number, y: number) => void
  hide: () => void
}

/** Large card preview that follows the cursor. */
export const useHover = create<HoverState>((set) => ({
  card: null,
  dimmed: false,
  x: 0,
  y: 0,
  show: (card, x, y, dimmed = false) => set({ card, x, y, dimmed }),
  move: (x, y) => set({ x, y }),
  hide: () => set({ card: null }),
}))

interface SelectionState {
  selected: Set<string>
  anchor: number | null
  mode: boolean
  setMode: (on: boolean) => void
  toggle: (key: string, index: number) => void
  selectRange: (keys: string[], index: number) => void
  selectAll: (keys: string[]) => void
  clear: () => void
}

export const useSelection = create<SelectionState>((set, get) => ({
  selected: new Set(),
  anchor: null,
  mode: false,
  setMode: (on) => set(on ? { mode: true } : { mode: false, selected: new Set(), anchor: null }),
  toggle: (key, index) => {
    const selected = new Set(get().selected)
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    set({ selected, anchor: index, mode: true })
  },
  /** shift+click: select everything between the anchor and `index` in the visible order */
  selectRange: (keys, index) => {
    const anchor = get().anchor ?? index
    const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
    const selected = new Set(get().selected)
    for (let i = from; i <= to; i++) selected.add(keys[i])
    set({ selected, anchor: index, mode: true })
  },
  selectAll: (keys) => set({ selected: new Set(keys), mode: true }),
  clear: () => set({ selected: new Set(), anchor: null }),
}))

interface DetailState {
  entryKey: string | null
  open: (key: string) => void
  close: () => void
}

export const useDetail = create<DetailState>((set) => ({
  entryKey: null,
  open: (entryKey) => set({ entryKey }),
  close: () => set({ entryKey: null }),
}))

interface PendingMoxfieldState {
  /** a deck the bookmarklet sent, waiting for its list to open the sync dialog */
  deck: MoxfieldDeck | null
  set: (deck: MoxfieldDeck | null) => void
}

export const usePendingMoxfield = create<PendingMoxfieldState>((set) => ({
  deck: null,
  set: (deck) => set({ deck }),
}))

export interface Grouping {
  by: GroupBy
  then: ThenBy
}

const groupingKey = (kind: ListKind) => `mbv:grouping:${kind}`

/** How the cards of a cube or deck were last grouped in this browser; decks start by type, cubes by color then type. */
export function getGrouping(kind: ListKind): Grouping {
  const fallback: GroupBy = kind === 'deck' ? 'type' : 'color'
  try {
    const saved = JSON.parse(localStorage.getItem(groupingKey(kind)) ?? 'null') as Partial<Grouping> | null
    const by = saved?.by && Object.hasOwn(GROUP_LABEL, saved.by) ? saved.by : fallback
    const then = saved?.then && thenByOptions(by).includes(saved.then) ? saved.then : defaultThenBy(by)
    return { by, then }
  } catch {
    return { by: fallback, then: defaultThenBy(fallback) }
  }
}

export function setGrouping(kind: ListKind, grouping: Grouping) {
  try {
    localStorage.setItem(groupingKey(kind), JSON.stringify(grouping))
  } catch {
    /* storage unavailable */
  }
}
