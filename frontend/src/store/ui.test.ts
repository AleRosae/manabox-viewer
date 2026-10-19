import { beforeEach, describe, expect, it } from 'vitest'
import { getGrouping, setGrouping } from './ui'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
} as Storage

describe('grouping preference', () => {
  beforeEach(() => store.clear())

  it('starts cubes by color then type and decks by type alone', () => {
    expect(getGrouping('cube')).toEqual({ by: 'color', then: 'type' })
    expect(getGrouping('deck')).toEqual({ by: 'type', then: 'none' })
  })

  it('remembers cubes and decks separately', () => {
    setGrouping('cube', { by: 'color', then: 'rarity' })
    expect(getGrouping('cube')).toEqual({ by: 'color', then: 'rarity' })
    expect(getGrouping('deck')).toEqual({ by: 'type', then: 'none' })
  })

  it('ignores invalid saved values', () => {
    store.set('mbv:grouping:cube', JSON.stringify({ by: 'toString', then: 'rarity' }))
    expect(getGrouping('cube')).toEqual({ by: 'color', then: 'rarity' })
    store.set('mbv:grouping:cube', JSON.stringify({ by: 'rarity', then: 'rarity' }))
    expect(getGrouping('cube')).toEqual({ by: 'rarity', then: 'type' })
    store.set('mbv:grouping:cube', '{not json')
    expect(getGrouping('cube')).toEqual({ by: 'color', then: 'type' })
  })
})
