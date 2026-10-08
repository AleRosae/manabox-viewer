import { describe, expect, it } from 'vitest'
import { groupItems, listTags } from './listGroups'
import type { Card, ListItem } from './types'

const item = (name: string, opts: { rarity?: string; cmc?: number; tags?: string[]; quantity?: number; owned?: number }): ListItem =>
  ({
    id: 0,
    oracle_id: name,
    scryfall_id: name,
    quantity: opts.quantity ?? 1,
    owned: opts.owned ?? 0,
    used_elsewhere: 0,
    ownership: 'not_owned',
    their_owned: null,
    added_at: '',
    tags: opts.tags ?? [],
    card: { name, rarity: opts.rarity ?? 'common', cmc: opts.cmc ?? 1, type_line: 'Instant', colors: ['U'] } as Card,
  }) as ListItem

const price = () => 2

describe('groupItems', () => {
  it('groups by rarity in rarity order, with per-group stats', () => {
    const groups = groupItems(
      [
        item('Bolt', { rarity: 'uncommon', quantity: 2, owned: 1 }),
        item('Lotus', { rarity: 'mythic' }),
        item('Opt', { rarity: 'common', owned: 3 }),
        item('Brainstorm', { rarity: 'common', cmc: 0 }),
      ],
      'rarity',
      price,
    )
    expect(groups.map((g) => [g.title, g.items.map((i) => i.card.name)])).toEqual([
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
    const groups = groupItems([item('Bolt', { tags: ['Burn'] }), item('Shock', { tags: ['burn'] })], 'tag', price)
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([['Burn', 2]])
  })

  it('groups by tag: a card in every tag, untagged last', () => {
    const groups = groupItems(
      [item('Opt', { tags: ['tempo', 'Cantrip'] }), item('Bolt', { tags: ['Burn'] }), item('Lotus', {})],
      'tag',
      price,
    )
    expect(groups.map((g) => [g.title, g.items.map((i) => i.card.name)])).toEqual([
      ['Burn', ['Bolt']],
      ['Cantrip', ['Opt']],
      ['tempo', ['Opt']],
      ['Untagged', ['Lotus']],
    ])
  })
})

describe('listTags', () => {
  it('lists distinct tags alphabetically', () => {
    expect(listTags([{ tags: ['b', 'A'] }, { tags: ['a', 'C'] }])).toEqual(['A', 'b', 'C'])
  })
})
