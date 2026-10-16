import { describe, expect, it } from 'vitest'
import { defaultThenBy, groupDeckItems, groupItems, type ItemGroup, listTags, thenByAfter, thenByOptions } from './listGroups'
import type { Board, Card, ListItem } from './types'

let nextId = 1
const item = (name: string, opts: { rarity?: string; cmc?: number; type?: string; tags?: string[]; quantity?: number; owned?: number; board?: Board }): ListItem =>
  ({
    id: nextId++,
    board: opts.board ?? 'main',
    oracle_id: name,
    scryfall_id: name,
    quantity: opts.quantity ?? 1,
    owned: opts.owned ?? 0,
    used_elsewhere: 0,
    ownership: 'not_owned',
    their_owned: null,
    added_at: '',
    tags: opts.tags ?? [],
    card: { name, rarity: opts.rarity ?? 'common', cmc: opts.cmc ?? 1, type_line: opts.type ?? 'Instant', colors: ['U'] } as Card,
  }) as ListItem

const price = () => 2

/** The card names of a group, sub-group after sub-group. */
const names = (g: ItemGroup) => g.subgroups.flatMap((s) => s.items.map((i) => i.card.name))

describe('groupItems', () => {
  it('splits a group by type by default, then orders by mana value and name', () => {
    const [blue] = groupItems(
      [
        item('Counterspell', { cmc: 2 }),
        item('Ponder', { cmc: 1, type: 'Sorcery' }),
        item('Opt', { cmc: 1 }),
        item('Snapcaster Mage', { cmc: 2, type: 'Creature — Human Wizard' }),
        item('Delver of Secrets', { cmc: 1, type: 'Creature — Human Wizard' }),
        item('Brainstorm', { cmc: 1 }),
      ],
      'color',
      defaultThenBy('color'),
      price,
    )
    expect(names(blue)).toEqual(['Delver of Secrets', 'Snapcaster Mage', 'Brainstorm', 'Opt', 'Counterspell', 'Ponder'])
    expect(blue.subgroups.map((s) => [s.key, s.items.length])).toEqual([
      ['Creature', 2],
      ['Instant', 3],
      ['Sorcery', 1],
    ])
  })

  it('splits a group by rarity', () => {
    const [blue] = groupItems(
      [item('Force of Will', { rarity: 'rare', cmc: 5 }), item('Jace', { rarity: 'mythic', cmc: 4 }), item('Opt', {}), item('Snapcaster Mage', { rarity: 'rare', cmc: 2 })],
      'color',
      'rarity',
      price,
    )
    expect(blue.subgroups.map((s) => [s.key, s.items.map((i) => i.card.name)])).toEqual([
      ['common', ['Opt']],
      ['rare', ['Snapcaster Mage', 'Force of Will']],
      ['mythic', ['Jace']],
    ])
  })

  it('keeps a group whole with no second level', () => {
    const [blue] = groupItems([item('Ponder', { type: 'Sorcery' }), item('Delver', { type: 'Creature' }), item('Counterspell', { cmc: 2 })], 'color', 'none', price)
    expect(blue.subgroups.map((s) => s.items.map((i) => i.card.name))).toEqual([['Delver', 'Ponder', 'Counterspell']])
  })

  it('puts a card with several tags in each tag sub-group, counting it once in the group', () => {
    const [blue] = groupItems([item('Opt', { tags: ['tempo', 'Cantrip'] }), item('Bolt', {})], 'color', 'tag', price)
    expect(blue.subgroups.map((s) => [s.key, s.items.map((i) => i.card.name)])).toEqual([
      ['cantrip', ['Opt']],
      ['tempo', ['Opt']],
      ['', ['Bolt']],
    ])
    expect(blue.copies).toBe(2)
  })

  it('puts a card once in a tag sub-group when its tags differ only in case', () => {
    const [blue] = groupItems([item('Bolt', { tags: ['Burn', 'burn'] })], 'color', 'tag', price)
    expect(blue.subgroups.map((s) => [s.key, s.items.length])).toEqual([['burn', 1]])
  })

  it('groups by rarity in rarity order, with per-group stats', () => {
    const groups = groupItems(
      [
        item('Bolt', { rarity: 'uncommon', quantity: 2, owned: 1 }),
        item('Lotus', { rarity: 'mythic' }),
        item('Opt', { rarity: 'common', owned: 3 }),
        item('Brainstorm', { rarity: 'common', cmc: 0 }),
      ],
      'rarity',
      'none',
      price,
    )
    expect(groups.map((g) => [g.title, names(g)])).toEqual([
      ['Common', ['Brainstorm', 'Opt']],
      ['Uncommon', ['Bolt']],
      ['Mythic', ['Lotus']],
    ])
    expect(groups.map((g) => [g.copies, g.owned, g.missingValue])).toEqual([
      [2, 1, 2],
      [2, 1, 2],
      [1, 0, 2],
    ])
  })

  it('matches tags case-insensitively', () => {
    const groups = groupItems([item('Bolt', { tags: ['Burn'] }), item('Shock', { tags: ['burn'] })], 'tag', 'none', price)
    expect(groups.map((g) => [g.title, g.copies])).toEqual([['Burn', 2]])
  })

  it('groups by tag: a card in every tag, untagged last', () => {
    const groups = groupItems(
      [item('Opt', { tags: ['tempo', 'Cantrip'] }), item('Bolt', { tags: ['Burn'] }), item('Lotus', {})],
      'tag',
      'none',
      price,
    )
    expect(groups.map((g) => [g.title, names(g)])).toEqual([
      ['Burn', ['Bolt']],
      ['Cantrip', ['Opt']],
      ['tempo', ['Opt']],
      ['Untagged', ['Lotus']],
    ])
  })
})

describe('second level', () => {
  it('offers every criterion but the first, and none', () => {
    expect(thenByOptions('color')).toEqual(['none', 'type', 'mv', 'rarity', 'tag'])
    expect(thenByOptions('type')).toEqual(['none', 'color', 'mv', 'rarity', 'tag'])
  })

  it('defaults to type, or none when the groups are types', () => {
    expect(defaultThenBy('color')).toBe('type')
    expect(defaultThenBy('rarity')).toBe('type')
    expect(defaultThenBy('type')).toBe('none')
  })

  it('follows the new default when the first level changes, unless the user picked one', () => {
    expect(thenByAfter('type', 'none', 'color')).toBe('type')
    expect(thenByAfter('color', 'type', 'type')).toBe('none')
    expect(thenByAfter('color', 'rarity', 'mv')).toBe('rarity')
    expect(thenByAfter('color', 'rarity', 'rarity')).toBe('type')
  })
})

describe('listTags', () => {
  it('lists distinct tags alphabetically', () => {
    expect(listTags([{ tags: ['b', 'A'] }, { tags: ['a', 'C'] }])).toEqual(['A', 'b', 'C'])
  })
})

describe('groupDeckItems', () => {
  it('puts the command zone first, groups the main deck, and keeps side and maybe boards whole', () => {
    const groups = groupDeckItems(
      [
        item('Duress', { board: 'side' }),
        item('Bolt', { rarity: 'uncommon' }),
        item('Atraxa', { board: 'commander', rarity: 'mythic' }),
        item('Opt', {}),
        item('Thoughtseize', { board: 'maybe' }),
      ],
      'rarity',
      'none',
      price,
    )
    expect(groups.map((g) => [g.title, names(g)])).toEqual([
      ['Commander', ['Atraxa']],
      ['Common', ['Opt']],
      ['Uncommon', ['Bolt']],
      ['Sideboard', ['Duress']],
      ['Maybeboard', ['Thoughtseize']],
    ])
  })

  it('splits the side and maybe boards too', () => {
    const groups = groupDeckItems(
      [item('Duress', { board: 'side', type: 'Sorcery' }), item('Kitesail Freebooter', { board: 'side', type: 'Creature', cmc: 2 })],
      'type',
      'mv',
      price,
    )
    expect(groups.map((g) => [g.title, g.subgroups.map((s) => s.key)])).toEqual([['Sideboard', ['1', '2']]])
  })

  it('splits the board groups like the main deck when there is no second level', () => {
    const [side] = groupDeckItems(
      [item('Mountain', { board: 'side', type: 'Basic Land — Mountain', cmc: 0 }), item('Duress', { board: 'side' }), item('Goblin Guide', { board: 'side', type: 'Creature' })],
      'type',
      'none',
      price,
    )
    expect(side.subgroups.map((s) => [s.key, s.items.map((i) => i.card.name)])).toEqual([
      ['Creature', ['Goblin Guide']],
      ['Instant', ['Duress']],
      ['Land', ['Mountain']],
    ])
  })
})
