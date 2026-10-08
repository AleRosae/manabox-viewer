import { BUCKET_COLOR, BUCKET_LABEL, BUCKET_ORDER, colorBucket, isLand, primaryType, RARITY_ORDER } from './cards'
import type { ListItem } from './types'

export type GroupBy = 'color' | 'type' | 'mv' | 'rarity' | 'tag'

export const GROUP_LABEL: Record<GroupBy, string> = { color: 'Color', type: 'Type', mv: 'Mana value', rarity: 'Rarity', tag: 'Tag' }

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

export interface ItemGroup {
  key: string
  title: string
  color: string
  items: ListItem[]
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
      return i.tags.length ? i.tags.map((t) => t.toLowerCase()) : [UNTAGGED]
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

/** Groups in display order, cards sorted by mana value then name; `price` is the unit market value. */
export function groupItems(items: ListItem[], by: GroupBy, price: (i: ListItem) => number): ItemGroup[] {
  const groups = new Map<string, ListItem[]>()
  for (const i of items) for (const k of keysOf(i, by)) groups.set(k, [...(groups.get(k) ?? []), i])
  const tagNames = new Map(listTags(items).map((t) => [t.toLowerCase(), t]))
  return order(by, [...groups.keys()]).map((k) => {
    const members = groups.get(k)!.sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name))
    return {
      key: k,
      title: title(by, k, tagNames),
      color: by === 'color' ? BUCKET_COLOR[k] : by === 'rarity' ? (RARITY_COLOR[k] ?? NEUTRAL) : NEUTRAL,
      items: members,
      copies: members.reduce((n, i) => n + i.quantity, 0),
      owned: members.reduce((n, i) => n + Math.min(i.owned, i.quantity), 0),
      missingValue: members.reduce((n, i) => n + Math.max(0, i.quantity - i.owned) * price(i), 0),
    }
  })
}

/** Does the item carry this tag (case-insensitively)? */
export const hasTag = (i: { tags: string[] }, tag: string) => i.tags.some((t) => t.toLowerCase() === tag.toLowerCase())

/** Every tag used in the list, alphabetically; the first spelling met wins. */
export function listTags(items: { tags: string[] }[]): string[] {
  const seen = new Map<string, string>()
  for (const i of items) for (const t of i.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
