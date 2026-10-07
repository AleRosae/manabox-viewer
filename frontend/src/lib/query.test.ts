import { describe, expect, it } from 'vitest'
import { buildEntries } from './cards'
import { matches, parseQuery } from './query'
import { computeStats } from './stats'
import type { Card, Entry, Row } from './types'

let nextId = 0

function card(over: Partial<Card>): Card {
  const id = `id-${nextId++}`
  return {
    id,
    oracle_id: `o-${over.name ?? id}`,
    name: 'Test',
    lang: 'en',
    layout: 'normal',
    mana_cost: '',
    cmc: 0,
    type_line: 'Creature',
    oracle_text: '',
    colors: [],
    color_identity: [],
    keywords: [],
    power: null,
    toughness: null,
    loyalty: null,
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    released_at: '2020-01-01',
    artist: 'Someone',
    legal: ['legacy', 'vintage'],
    games: ['paper'],
    faces: [],
    image_faces: 1,
    prices: { eur: '1.00', eur_foil: '3.00', eur_etched: null, usd: '1.20', usd_foil: null, usd_etched: null },
    scryfall_uri: null,
    ...over,
  }
}

function row(c: Card, over: Partial<Row> = {}): Row {
  return {
    id: nextId++,
    binder_name: 'binder A',
    name: c.name,
    set_code: c.set.toUpperCase(),
    collector_number: c.collector_number,
    finish: 'normal',
    rarity: c.rarity,
    quantity: 1,
    scryfall_id: c.id,
    purchase_price: 0.5,
    currency: 'EUR',
    condition: 'near_mint',
    language: 'en',
    signed: 0,
    altered: 0,
    misprint: 0,
    proxy: 0,
    added_at: '2025-01-01T00:00:00Z',
    ...over,
  }
}

const bolt = card({ name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'], color_identity: ['R'], set: 'clu', rarity: 'common', legal: ['legacy', 'pauper'] })
const counterspell = card({ name: 'Counterspell', mana_cost: '{U}{U}', cmc: 2, type_line: 'Instant', oracle_text: 'Counter target spell.', colors: ['U'], color_identity: ['U'], rarity: 'rare', set: 'sld', prices: { eur: '5.35', eur_foil: null, eur_etched: null, usd: null, usd_foil: null, usd_etched: null } })
const sliver = card({ name: 'The First Sliver', mana_cost: '{W}{U}{B}{R}{G}', cmc: 5, type_line: 'Legendary Creature — Sliver', colors: ['W', 'U', 'B', 'R', 'G'], color_identity: ['W', 'U', 'B', 'R', 'G'], rarity: 'mythic', power: '7', toughness: '7', keywords: ['Cascade'], set: 'mh1' })
const augustin = card({ name: 'Grand Arbiter Augustin IV', mana_cost: '{2}{W}{U}', cmc: 4, type_line: 'Legendary Creature — Human Advisor', colors: ['W', 'U'], color_identity: ['W', 'U'], rarity: 'rare', power: '2', toughness: '3' })
const shadowspear = card({ name: 'Shadowspear', mana_cost: '{1}', cmc: 1, type_line: 'Legendary Artifact — Equipment', rarity: 'rare' })
const tomb = card({ name: 'Overgrown Tomb', type_line: 'Land — Swamp Forest', color_identity: ['B', 'G'], rarity: 'rare' })
const valakut = card({ name: 'Valakut Awakening // Valakut Stoneforge', mana_cost: '{2}{R}', cmc: 3, type_line: 'Instant // Land', layout: 'modal_dfc', image_faces: 2, colors: ['R'], color_identity: ['R'], faces: [
  { name: 'Valakut Awakening', mana_cost: '{2}{R}', type_line: 'Instant', oracle_text: 'Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.', colors: ['R'], power: null, toughness: null, loyalty: null, has_image: true },
  { name: 'Valakut Stoneforge', mana_cost: '', type_line: 'Land', oracle_text: 'As Valakut Stoneforge enters, you may pay 3 life.', colors: [], power: null, toughness: null, loyalty: null, has_image: true },
] })

const all = [bolt, counterspell, sliver, augustin, shadowspear, tomb, valakut]
const cards = Object.fromEntries(all.map((c) => [c.id, c]))
const rows = [
  row(bolt, { quantity: 3, binder_name: 'Bulk noi 2' }),
  row(bolt, { binder_name: 'binder A', finish: 'foil' }),
  row(counterspell, { binder_name: 'binder A', language: 'it' }),
  row(sliver),
  row(augustin),
  row(shadowspear, { proxy: 1 }),
  row(tomb, { quantity: 2 }),
  row(valakut),
]
const entries: Entry[] = buildEntries(rows, cards, 'all', 0.9)

function search(q: string): string[] {
  const { node, errors } = parseQuery(q)
  expect(errors).toEqual([])
  return entries.filter((e) => matches(node, e)).map((e) => e.card.name).sort()
}

describe('parseQuery / matches', () => {
  it.each([
    ['bolt', ['Lightning Bolt']],
    ['!"counterspell"', ['Counterspell']],
    ['stoneforge', ['Valakut Awakening // Valakut Stoneforge']],
    ['c:r', ['Lightning Bolt', 'The First Sliver', 'Valakut Awakening // Valakut Stoneforge']],
    ['c=r', ['Lightning Bolt', 'Valakut Awakening // Valakut Stoneforge']],
    ['c<=wu -c:c', ['Counterspell', 'Grand Arbiter Augustin IV']],
    ['c:azorius', ['Grand Arbiter Augustin IV', 'The First Sliver']],
    ['c:m', ['Grand Arbiter Augustin IV', 'The First Sliver']],
    ['c:c', ['Overgrown Tomb', 'Shadowspear']],
    ['id:golgari', ['Overgrown Tomb', 'Shadowspear']],
    ['t:legendary t:creature', ['Grand Arbiter Augustin IV', 'The First Sliver']],
    ['-t:creature -t:land', ['Counterspell', 'Lightning Bolt', 'Shadowspear']], // MDFC 'Instant // Land' matches t:land, as on Scryfall,
    ['o:"draw that many"', ['Valakut Awakening // Valakut Stoneforge']],
    ['o:"~ deals 3"', ['Lightning Bolt']],
    ['m:{U}{U}', ['Counterspell']],
    ['m:wu', ['Grand Arbiter Augustin IV', 'The First Sliver']],
    ['mv<=1 -t:land', ['Lightning Bolt', 'Shadowspear']],
    ['mv>=4', ['Grand Arbiter Augustin IV', 'The First Sliver']],
    ['pow>=5', ['The First Sliver']],
    ['r>=rare t:instant', ['Counterspell']],
    ['r:mythic', ['The First Sliver']],
    ['s:sld', ['Counterspell']],
    ['kw:cascade', ['The First Sliver']],
    ['is:foil', ['Lightning Bolt']],
    ['is:dfc', ['Valakut Awakening // Valakut Stoneforge']],
    ['is:mdfc', ['Valakut Awakening // Valakut Stoneforge']],
    ['is:commander', ['Grand Arbiter Augustin IV', 'The First Sliver']],
    ['is:proxy', ['Shadowspear']],
    ['f:pauper', ['Lightning Bolt']],
    ['eur>=5', ['Counterspell']],
    ['qty>=3', ['Lightning Bolt']],
    ['binder:bulk', ['Lightning Bolt']],
    ['lang:it', ['Counterspell']],
    ['(t:instant OR t:artifact) -c:u', ['Lightning Bolt', 'Shadowspear', 'Valakut Awakening // Valakut Stoneforge']],
    ['mv<=2 OR o:"draw that many"', ['Counterspell', 'Lightning Bolt', 'Overgrown Tomb', 'Shadowspear', 'Valakut Awakening // Valakut Stoneforge']],
  ])('%s', (q, expected) => {
    expect(search(q)).toEqual(expected)
  })

  it('reports unknown keys and unbalanced parentheses', () => {
    expect(parseQuery('foo:bar').errors).toEqual(['Filtro sconosciuto: foo'])
    expect(parseQuery('(t:instant').errors).toEqual(['Parentesi non chiusa'])
  })

  it('empty query matches everything', () => {
    expect(parseQuery('   ').node).toBeNull()
  })
})

describe('buildEntries', () => {
  it('groups by oracle id in the all-binders scope', () => {
    const boltEntry = entries.find((e) => e.card.name === 'Lightning Bolt')!
    expect(boltEntry.quantity).toBe(4)
    expect(boltEntry.binders).toEqual(['Bulk noi 2', 'binder A'])
    // the foil row is the most valuable printing
    expect(boltEntry.unitMarket).toBe(3)
    expect(boltEntry.marketValue).toBe(3 * 1 + 1 * 3)
  })

  it('keeps one entry per row in a binder scope', () => {
    const binder = buildEntries(rows, cards, 'binder A', 0.9)
    expect(binder.map((e) => e.card.name)).toContain('Lightning Bolt')
    expect(binder.find((e) => e.card.name === 'Lightning Bolt')!.quantity).toBe(1)
  })

  it('falls back to converted USD when there is no EUR price', () => {
    const c = card({ name: 'Usd only', prices: { eur: null, eur_foil: null, eur_etched: null, usd: '10.00', usd_foil: null, usd_etched: null } })
    const [e] = buildEntries([row(c)], { [c.id]: c }, 'all', 0.9)
    expect(e.unitMarket).toBe(9)
  })
})

describe('computeStats', () => {
  it('computes buckets, curve and totals', () => {
    const stats = computeStats(entries.map((e) => ({ card: e.card, quantity: e.quantity, unitMarket: e.unitMarket, purchaseValue: e.purchaseValue, foil: e.foil })))
    expect(stats.copies).toBe(11)
    expect(stats.unique).toBe(7)
    const colors = Object.fromEntries(stats.colors.map((b) => [b.key, b.value]))
    expect(colors).toMatchObject({ R: 5, U: 1, M: 2, C: 1, L: 2 })
    const curve = Object.fromEntries(stats.curve.map((b) => [b.label, b.value]))
    expect(curve).toMatchObject({ '1': 5, '2': 1, '3': 1, '4': 1, '5': 1 })
    expect(stats.types.find((t) => t.key === 'Land')!.value).toBe(2)
  })
})
