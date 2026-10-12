import { describe, expect, it } from 'vitest'
import { canBeCommander, copyLimit, validateDeck, validPair, type DeckCard } from './legality'
import type { Board, Card } from './types'

const card = (name: string, opts: Partial<Card> = {}): Card =>
  ({
    name,
    type_line: 'Instant',
    oracle_text: '',
    keywords: [],
    color_identity: [],
    faces: [],
    legalities: { commander: 'legal', modern: 'legal', vintage: 'legal', pauper: 'legal' },
    ...opts,
  }) as Card

const entry = (c: Card, quantity = 1, board: Board = 'main'): DeckCard => ({ oracle_id: c.name, board, quantity, card: c })

/** `n` different filler cards. */
const fillers = (n: number, opts: Partial<Card> = {}) => Array.from({ length: n }, (_, i) => entry(card(`Filler ${i}`, opts)))

const messages = (items: DeckCard[], format: Parameters<typeof validateDeck>[1]) => validateDeck(items, format).map((i) => i.message)

describe('copy limits', () => {
  it('lets basic lands and "any number" cards go past the limit', () => {
    expect(copyLimit(card('Island', { type_line: 'Basic Land — Island' }), 4)).toBe(Infinity)
    expect(copyLimit(card('Snow-Covered Island', { type_line: 'Basic Snow Land — Island' }), 1)).toBe(Infinity)
    expect(copyLimit(card('Relentless Rats', { oracle_text: 'A deck can have any number of cards named Relentless Rats.' }), 4)).toBe(Infinity)
    expect(copyLimit(card('Seven Dwarves', { oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' }), 4)).toBe(7)
    expect(copyLimit(card('Opt'), 4)).toBe(4)
  })
})

describe('constructed formats', () => {
  it('checks deck and sideboard size, copies, bans and restrictions', () => {
    const bolt = card('Lightning Bolt')
    const lotus = card('Black Lotus', { legalities: { modern: 'not_legal', vintage: 'restricted' } })
    const items = [...fillers(54), entry(bolt, 5), entry(lotus, 2), ...fillers(16, { name: 'x' }).map((e, i) => ({ ...e, oracle_id: `s${i}`, board: 'side' as Board }))]
    expect(messages(items, 'modern')).toEqual([
      '16 cards in the sideboard: at most 15',
      '5 copies of Lightning Bolt: at most 4',
      'Not legal in Modern: Black Lotus',
    ])
    expect(messages(items, 'vintage')).toEqual([
      '16 cards in the sideboard: at most 15',
      '5 copies of Lightning Bolt: at most 4',
      'Black Lotus is restricted: 1 copy at most',
    ])
    expect(messages(fillers(59), 'pauper')).toEqual(['59 cards in the main deck: at least 60'])
    expect(messages(fillers(60), 'pauper')).toEqual([])
  })

  it('ignores the maybeboard and everything without a format', () => {
    const banned = card('Banned', { legalities: { modern: 'banned' } })
    expect(messages([...fillers(60), entry(banned, 9, 'maybe')], 'modern')).toEqual([])
    expect(messages([entry(banned, 9)], 'none')).toEqual([])
  })
})

describe('commander', () => {
  const atraxa = card("Atraxa, Praetors' Voice", { type_line: 'Legendary Creature — Phyrexian Angel Horror', color_identity: ['W', 'U', 'B', 'G'] })

  it('needs 100 singleton cards within the commander identity', () => {
    const ok = [entry(atraxa, 1, 'commander'), ...fillers(99, { color_identity: ['U'] })]
    expect(messages(ok, 'commander')).toEqual([])

    const red = card('Lightning Bolt', { color_identity: ['R'] })
    const twice = card('Sol Ring')
    const bad = [entry(atraxa, 1, 'commander'), ...fillers(96), entry(red), entry(twice, 2)]
    expect(messages(bad, 'commander')).toEqual([
      "1 card outside the commander's color identity: Lightning Bolt",
      '2 copies of Sol Ring: at most 1',
    ])
    expect(messages(fillers(99), 'commander')).toEqual(['99 cards with the commander: the deck needs exactly 100', 'No commander: move a card to the Commander board'])
  })

  it('checks who can lead and who can share the command zone', () => {
    const bolt = card('Lightning Bolt')
    expect(canBeCommander(atraxa)).toBe(true)
    expect(canBeCommander(card('Grist', { type_line: 'Legendary Planeswalker — Grist', oracle_text: 'Grist can be your commander.' }))).toBe(true)
    expect(canBeCommander(bolt)).toBe(false)
    expect(messages([entry(bolt, 1, 'commander'), ...fillers(99)], 'commander')).toEqual(["Lightning Bolt can't be a commander"])

    const tymna = card('Tymna the Weaver', { type_line: 'Legendary Creature — Human Cleric', keywords: ['Partner'] })
    const thrasios = card('Thrasios, Triton Hero', { type_line: 'Legendary Creature — Merfolk Wizard', keywords: ['Partner'] })
    const wilson = card('Wilson, Refined Grizzly', { type_line: 'Legendary Creature — Bear Warrior', oracle_text: 'Choose a Background' })
    const background = card('Raised by Giants', { type_line: 'Legendary Enchantment — Background' })
    expect(validPair(tymna, thrasios)).toBe(true)
    expect(validPair(wilson, background)).toBe(true)
    expect(messages([entry(wilson, 1, 'commander'), entry(background, 1, 'commander'), ...fillers(98)], 'commander')).toEqual([])
    expect(messages([entry(background, 1, 'commander'), ...fillers(99)], 'commander')).toEqual(["Raised by Giants can't be a commander"])
    expect(validPair(atraxa, tymna)).toBe(false)
    expect(messages([entry(atraxa, 1, 'commander'), entry(tymna, 1, 'commander'), ...fillers(98)], 'commander')).toEqual([
      "Atraxa, Praetors' Voice and Tymna the Weaver can't be commanders together",
    ])
  })
})
