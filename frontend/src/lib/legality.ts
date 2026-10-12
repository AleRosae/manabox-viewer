/** Deck formats and their construction rules: deck size, copies, banned cards, commanders. */

import type { Board, Card, DeckFormat } from './types'

export interface FormatRules {
  label: string
  /** constructed: at least this many cards in the main deck */
  minMain?: number
  /** commander: exactly this many cards, commanders included */
  size?: number
  maxSide?: number
  /** copies of a card across the deck and sideboard */
  maxCopies: number
  commander?: boolean
}

export const FORMATS: Record<DeckFormat, FormatRules> = {
  none: { label: 'No format', maxCopies: Infinity },
  standard: { label: 'Standard', minMain: 60, maxSide: 15, maxCopies: 4 },
  pioneer: { label: 'Pioneer', minMain: 60, maxSide: 15, maxCopies: 4 },
  modern: { label: 'Modern', minMain: 60, maxSide: 15, maxCopies: 4 },
  legacy: { label: 'Legacy', minMain: 60, maxSide: 15, maxCopies: 4 },
  vintage: { label: 'Vintage', minMain: 60, maxSide: 15, maxCopies: 4 },
  pauper: { label: 'Pauper', minMain: 60, maxSide: 15, maxCopies: 4 },
  premodern: { label: 'Premodern', minMain: 60, maxSide: 15, maxCopies: 4 },
  commander: { label: 'Commander', size: 100, maxCopies: 1, commander: true },
}

export const FORMAT_ORDER = Object.keys(FORMATS) as DeckFormat[]

export interface DeckCard {
  oracle_id: string
  board: Board
  quantity: number
  card: Card
}

export interface Issue {
  message: string
  /** cards the issue is about; none for deck-wide issues */
  oracleIds: string[]
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

/** Copies of the card a deck may hold beyond the format's limit (basic lands, Relentless Rats, Seven Dwarves...). */
export function copyLimit(card: Card, maxCopies: number): number {
  if (/\bBasic\b.*\bLand\b/.test(card.type_line.split(' // ')[0])) return Infinity
  if (/A deck can have any number of cards named/i.test(card.oracle_text)) return Infinity
  const upTo = /A deck can have up to (\w+) cards named/i.exec(card.oracle_text)
  if (upTo) return WORDS[upTo[1].toLowerCase()] ?? (Number(upTo[1]) || maxCopies)
  return maxCopies
}

export function canBeCommander(card: Card): boolean {
  const front = card.faces[0]?.type_line ?? card.type_line.split(' // ')[0]
  return (/\bLegendary\b/.test(front) && /\bCreature\b/.test(front)) || /can be your commander/i.test(card.oracle_text)
}

const hasPartner = (c: Card) => c.keywords.some((k) => /^(Partner|Friends forever)$/i.test(k))

/** Two cards that may share the command zone. */
export function validPair(a: Card, b: Card): boolean {
  const partnerWith = (x: Card, y: Card) => new RegExp(`Partner with ${y.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(x.oracle_text)
  const background = (x: Card, y: Card) => /Choose a Background/i.test(x.oracle_text) && /\bBackground\b/.test(y.type_line)
  const doctor = (x: Card, y: Card) => /Doctor's companion/i.test(x.oracle_text) && /\bDoctor\b/.test(y.type_line)
  return (
    (hasPartner(a) && hasPartner(b)) ||
    partnerWith(a, b) ||
    partnerWith(b, a) ||
    background(a, b) ||
    background(b, a) ||
    doctor(a, b) ||
    doctor(b, a)
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Everything that keeps the deck from being legal in its format; the maybeboard is not checked. */
export function validateDeck(items: DeckCard[], format: DeckFormat): Issue[] {
  const rules = FORMATS[format]
  if (format === 'none') return []
  const issues: Issue[] = []
  const played = items.filter((i) => i.board !== 'maybe')
  const count = (boards: Board[]) => played.filter((i) => boards.includes(i.board)).reduce((n, i) => n + i.quantity, 0)

  const commanders = played.filter((i) => i.board === 'commander')
  if (rules.commander) {
    const size = count(['commander', 'main'])
    if (size !== rules.size) issues.push({ message: `${plural(size, 'card')} with the commander: the deck needs exactly ${rules.size}`, oracleIds: [] })
    const commanderCards = commanders.reduce((n, i) => n + i.quantity, 0)
    if (commanderCards === 0) issues.push({ message: 'No commander: move a card to the Commander board', oracleIds: [] })
    else if (commanderCards > 2) issues.push({ message: `${commanderCards} commanders: at most 2 (partners)`, oracleIds: commanders.map((i) => i.oracle_id) })
    // A Background leads only next to a commander that chooses one (checked as a pair below).
    const chooser = commanders.some((c) => /Choose a Background/i.test(c.card.oracle_text))
    for (const c of commanders)
      if (!canBeCommander(c.card) && !(chooser && /\bBackground\b/.test(c.card.type_line))) issues.push({ message: `${c.card.name} can't be a commander`, oracleIds: [c.oracle_id] })
    if (commanders.length === 2 && !validPair(commanders[0].card, commanders[1].card))
      issues.push({ message: `${commanders[0].card.name} and ${commanders[1].card.name} can't be commanders together`, oracleIds: commanders.map((i) => i.oracle_id) })
    if (commanders.length) {
      const identity = new Set(commanders.flatMap((c) => c.card.color_identity))
      const outside = played.filter((i) => i.board !== 'commander' && i.card.color_identity.some((c) => !identity.has(c)))
      if (outside.length)
        issues.push({
          message: `${plural(outside.length, 'card')} outside the commander's color identity: ${outside.map((i) => i.card.name).join(', ')}`,
          oracleIds: outside.map((i) => i.oracle_id),
        })
    }
  } else {
    if (commanders.length) issues.push({ message: `${rules.label} has no commander`, oracleIds: commanders.map((i) => i.oracle_id) })
    const main = count(['main'])
    if (rules.minMain && main < rules.minMain) issues.push({ message: `${plural(main, 'card')} in the main deck: at least ${rules.minMain}`, oracleIds: [] })
    // A companion starts in the sideboard.
    const side = count(['side', 'companion'])
    if (rules.maxSide != null && side > rules.maxSide) issues.push({ message: `${plural(side, 'card')} in the sideboard: at most ${rules.maxSide}`, oracleIds: [] })
  }

  const byCard = new Map<string, { card: Card; quantity: number }>()
  for (const i of played) {
    const entry = byCard.get(i.oracle_id) ?? { card: i.card, quantity: 0 }
    entry.quantity += i.quantity
    byCard.set(i.oracle_id, entry)
  }
  const banned: string[] = []
  const notLegal: string[] = []
  for (const [oid, { card, quantity }] of byCard) {
    const status = card.legalities?.[format]
    if (status === 'banned') banned.push(oid)
    else if (status === 'not_legal') notLegal.push(oid)
    else if (status === 'restricted' && quantity > 1) issues.push({ message: `${card.name} is restricted: 1 copy at most`, oracleIds: [oid] })
    const limit = copyLimit(card, rules.maxCopies)
    if (quantity > limit && status !== 'restricted')
      issues.push({ message: `${quantity} copies of ${card.name}: at most ${limit}`, oracleIds: [oid] })
  }
  const names = (oids: string[]) => oids.map((o) => byCard.get(o)!.card.name).join(', ')
  if (banned.length) issues.push({ message: `Banned in ${rules.label}: ${names(banned)}`, oracleIds: banned })
  if (notLegal.length) issues.push({ message: `Not legal in ${rules.label}: ${names(notLegal)}`, oracleIds: notLegal })
  return issues
}
