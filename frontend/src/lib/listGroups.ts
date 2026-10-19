import { BUCKET_COLOR, BUCKET_LABEL, BUCKET_ORDER, colorBucket, isLand, primaryType, RARITY_ORDER } from './cards'
import type { Board, ListItem } from './types'

export type GroupBy = 'color' | 'type' | 'mv' | 'rarity' | 'tag'

export const GROUP_LABEL: Record<GroupBy, string> = { color: 'Color', type: 'Type', mv: 'Mana value', rarity: 'Rarity', tag: 'Tag' }

/** Second level: splits each group into sub-groups; `none` keeps the group whole. */
export type ThenBy = GroupBy | 'none'

export const THEN_LABEL: Record<ThenBy, string> = { none: 'None', ...GROUP_LABEL }

/** The second-level criteria available once the groups are made `by` something: every other one, or none. */
export const thenByOptions = (by: GroupBy): ThenBy[] => ['none', ...(Object.keys(GROUP_LABEL) as GroupBy[]).filter((g) => g !== by)]

/** Type inside each group (creatures first, lands last); nothing when the groups are types already. */
export const defaultThenBy = (by: GroupBy): ThenBy => (by === 'type' ? 'none' : 'type')

/** The second level once the first changes from `from` to `to`: a default follows the new default, a choice stays unless it collides. */
export const thenByAfter = (from: GroupBy, then: ThenBy, to: GroupBy): ThenBy =>
  then === to || then === defaultThenBy(from) ? defaultThenBy(to) : then

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other']
const TYPE_LABEL: Record<string, string> = {
  Creature: 'Creature', Planeswalker: 'Planeswalker', Instant: 'Instant', Sorcery: 'Sorcery', Artifact: 'Artifact',
  Enchantment: 'Enchantment', Battle: 'Battle', Land: 'Lands', Other: 'Other',
}
const MV_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', 'L']
const RARITY_COLOR: Record<string, string> = {
  common: '#B8BCC4', uncommon: '#8FB4C9', rare: '#D4B26A', mythic: '#E0763A', special: '#A77BD0', bonus: '#A77BD0',
}
const NEUTRAL = '#3A3F4B'
/** Group key of the cards without tags: sorts after every tag. */
export const UNTAGGED = ''

const capitalize = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown')

export interface ItemSubgroup {
  key: string
  items: ListItem[]
}

export interface ItemGroup {
  key: string
  title: string
  color: string
  /** the cards split by the second-level criterion; a single sub-group when there is none */
  subgroups: ItemSubgroup[]
  copies: number
  /** copies of the group covered by the collection */
  owned: number
  /** market value of the copies not owned */
  missingValue: number
}

function keysOf(i: ListItem, by: GroupBy): string[] {
  switch (by) {
    case 'color':
      return [colorBucket(i.card)]
    case 'type':
      return [primaryType(i.card)]
    case 'mv':
      return [isLand(i.card) ? 'L' : String(Math.min(7, Math.floor(i.card.cmc)))]
    case 'rarity':
      return [i.card.rarity ?? 'unknown']
    case 'tag':
      // A card with several tags shows up in each of their groups; tags match case-insensitively.
      return i.tags.length ? [...new Set(i.tags.map((t) => t.toLowerCase()))] : [UNTAGGED]
  }
}

function order(by: GroupBy, keys: string[]): string[] {
  const fixed = by === 'color' ? BUCKET_ORDER : by === 'type' ? TYPE_ORDER : by === 'mv' ? MV_ORDER : by === 'rarity' ? RARITY_ORDER : []
  const rest = keys.filter((k) => !fixed.includes(k) && k !== UNTAGGED).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return [...fixed.filter((k) => keys.includes(k)), ...rest, ...(keys.includes(UNTAGGED) ? [UNTAGGED] : [])]
}

function title(by: GroupBy, k: string, tagNames: Map<string, string>): string {
  switch (by) {
    case 'color':
      return BUCKET_LABEL[k]
    case 'type':
      return TYPE_LABEL[k]
    case 'mv':
      return k === 'L' ? 'Lands' : k === '7' ? 'MV 7+' : `MV ${k}`
    case 'rarity':
      return capitalize(k)
    case 'tag':
      return k === UNTAGGED ? 'Untagged' : (tagNames.get(k) ?? k)
  }
}

const byMvThenName = (a: ListItem, b: ListItem) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)

/** Buckets `items` by their keys, in display order; a card with several keys (tags) lands in each bucket. */
function bucket(items: ListItem[], by: GroupBy): [string, ListItem[]][] {
  const buckets = new Map<string, ListItem[]>()
  for (const i of items)
    for (const k of keysOf(i, by)) {
      const members = buckets.get(k)
      if (members) members.push(i)
      else buckets.set(k, [i])
    }
  return order(by, [...buckets.keys()]).map((k) => [k, buckets.get(k)!])
}

function makeGroup(key: string, title: string, color: string, items: ListItem[], then: ThenBy, price: (i: ListItem) => number): ItemGroup {
  const sorted = [...items].sort(byMvThenName)
  const subgroups = then === 'none' ? [{ key: '', items: sorted }] : bucket(sorted, then).map(([k, members]) => ({ key: k, items: members }))
  // The stats count each card once, even when its tags put it in several sub-groups.
  return {
    key,
    title,
    color,
    subgroups,
    copies: sorted.reduce((n, i) => n + i.quantity, 0),
    owned: sorted.reduce((n, i) => n + Math.min(i.owned, i.quantity), 0),
    missingValue: sorted.reduce((n, i) => n + Math.max(0, i.quantity - i.owned) * price(i), 0),
  }
}

/**
 * Groups in display order, each split into sub-groups `then`; cards sorted by mana value, then name.
 * `price` is the unit market value.
 */
export function groupItems(items: ListItem[], by: GroupBy, then: ThenBy, price: (i: ListItem) => number): ItemGroup[] {
  const tagNames = new Map(listTags(items).map((t) => [t.toLowerCase(), t]))
  return bucket(items, by).map(([k, members]) =>
    makeGroup(k, title(by, k, tagNames), by === 'color' ? BUCKET_COLOR[k] : by === 'rarity' ? (RARITY_COLOR[k] ?? NEUTRAL) : NEUTRAL, members, then, price),
  )
}

export const BOARD_ORDER: Board[] = ['commander', 'companion', 'main', 'side', 'maybe']
export const BOARD_LABEL: Record<Board, string> = { commander: 'Commander', companion: 'Companion', main: 'Main deck', side: 'Sideboard', maybe: 'Maybeboard' }
const BOARD_COLOR = '#D9B45A'

/**
 * Deck groups: the command zone first, the main deck grouped `by`, then sideboard and maybeboard as one group each.
 * Every group is split `then`; with no second level the board groups are split `by`, like the main deck's columns.
 */
export function groupDeckItems(items: ListItem[], by: GroupBy, then: ThenBy, price: (i: ListItem) => number): ItemGroup[] {
  return BOARD_ORDER.flatMap((board) => {
    const members = items.filter((i) => i.board === board)
    if (!members.length) return []
    if (board === 'main') return groupItems(members, by, then, price)
    return [makeGroup(`board:${board}`, BOARD_LABEL[board], BOARD_COLOR, members, then === 'none' ? by : then, price)]
  })
}

/** Played in this and other lists with more copies than the collection has (the maybeboard takes none). */
export const isOverused = (i: ListItem) => i.board !== 'maybe' && i.owned > 0 && i.quantity + i.used_elsewhere > i.owned

/** Does the item carry this tag (case-insensitively)? */
export const hasTag = (i: { tags: string[] }, tag: string) => i.tags.some((t) => t.toLowerCase() === tag.toLowerCase())

/** Every tag used in the list, alphabetically; the first spelling met wins. */
export function listTags(items: { tags: string[] }[]): string[] {
  const seen = new Map<string, string>()
  for (const i of items) for (const t of i.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
