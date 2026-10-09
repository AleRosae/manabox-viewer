/** Ownership comparison between me and whoever shared a list, item by item. */

export type CompareBucket = 'both' | 'only_me' | 'only_them' | 'neither'

export interface Comparable {
  quantity: number
  owned: number
  their_owned: number | null
}

export const COMPARE_LABEL: Record<CompareBucket, string> = {
  both: 'Both',
  only_me: 'Only you',
  only_them: 'Only them',
  neither: 'Neither',
}

export const COMPARE_ORDER: CompareBucket[] = ['both', 'only_me', 'only_them', 'neither']

/** "Has it" means owning every copy the list asks for; partial counts are shown as x/q. */
export function compareBucket(item: Comparable): CompareBucket | null {
  if (item.their_owned == null) return null
  const me = item.owned >= item.quantity
  const them = item.their_owned >= item.quantity
  return me && them ? 'both' : me ? 'only_me' : them ? 'only_them' : 'neither'
}

/** Copies each side is missing, capped to the list quantity. */
export const missingMine = (i: Comparable) => Math.max(0, i.quantity - i.owned)
export const missingTheirs = (i: Comparable) => (i.their_owned == null ? 0 : Math.max(0, i.quantity - i.their_owned))

export const hasComparison = (items: Comparable[]) => items.some((i) => i.their_owned != null)

export function compareSummary<T extends Comparable>(items: T[], unitPrice: (i: T) => number) {
  const counts: Record<CompareBucket, number> = { both: 0, only_me: 0, only_them: 0, neither: 0 }
  let youMiss = 0
  let theyMiss = 0
  let youMissValue = 0
  let theyMissValue = 0
  for (const i of items) {
    const b = compareBucket(i)
    if (b) counts[b] += 1
    const mine = missingMine(i)
    const theirs = missingTheirs(i)
    youMiss += mine
    theyMiss += theirs
    youMissValue += mine * unitPrice(i)
    theyMissValue += theirs * unitPrice(i)
  }
  return { counts, youMiss, theyMiss, youMissValue, theyMissValue }
}

export type CompareFilter = 'all' | 'you_miss' | 'they_miss' | CompareBucket

export function inFilter(i: Comparable, filter: CompareFilter) {
  if (filter === 'all') return true
  if (filter === 'you_miss') return missingMine(i) > 0
  if (filter === 'they_miss') return missingTheirs(i) > 0
  return compareBucket(i) === filter
}

/** Copies a filter is about: the missing ones for "missing" filters, the whole quantity otherwise. */
export function filterCopies(i: Comparable, filter: CompareFilter) {
  return filter === 'you_miss' ? missingMine(i) : filter === 'they_miss' ? missingTheirs(i) : i.quantity
}

interface Printable extends Comparable {
  card: { name: string; set: string; collector_number: string }
}

/** '1 Name (SET) 123' lines of the cards in a filter, like the backend's plain text export. */
export function compareExportText(items: Printable[], filter: CompareFilter) {
  const lines = items
    .filter((i) => inFilter(i, filter))
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map((i) => `${filterCopies(i, filter)} ${i.card.name} (${i.card.set.toUpperCase()}) ${i.card.collector_number}`)
  return lines.length ? lines.join('\n') + '\n' : ''
}
