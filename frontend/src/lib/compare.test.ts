import { describe, expect, it } from 'vitest'
import { compareBucket, compareExportText, compareSummary, hasComparison } from './compare'

const item = (quantity: number, owned: number, their_owned: number | null) => ({ quantity, owned, their_owned })

describe('compareBucket', () => {
  it.each([
    [item(1, 1, 1), 'both'],
    [item(2, 3, 2), 'both'],
    [item(2, 2, 1), 'only_me'],
    [item(1, 0, 4), 'only_them'],
    [item(2, 1, 1), 'neither'],
    [item(1, 0, 0), 'neither'],
    [item(1, 1, null), null],
  ])('%o -> %s', (i, expected) => {
    expect(compareBucket(i)).toBe(expected)
  })
})

describe('compareSummary', () => {
  it('counts buckets and missing copies with their value', () => {
    const items = [item(2, 2, 0), item(1, 0, 1), item(3, 1, 2), item(1, 1, null)]
    const s = compareSummary(items, () => 2)
    expect(s.counts).toEqual({ both: 0, only_me: 1, only_them: 1, neither: 1 })
    expect(s.youMiss).toBe(1 + 2)
    expect(s.theyMiss).toBe(2 + 1)
    expect(s.youMissValue).toBe(6)
    expect(s.theyMissValue).toBe(6)
  })

  it('detects lists without the sharer ownership', () => {
    expect(hasComparison([item(1, 1, null)])).toBe(false)
    expect(hasComparison([item(1, 1, null), item(1, 0, 0)])).toBe(true)
  })
})

describe('compareExportText', () => {
  const card = (name: string) => ({ name, set: 'tst', collector_number: '7' })
  const items = [
    { ...item(2, 1, 0), card: card('Zombie') },
    { ...item(1, 1, 0), card: card('Angel') },
    { ...item(3, 3, 3), card: card('Bear') },
  ]

  it('lists the missing copies for the missing filters', () => {
    expect(compareExportText(items, 'you_miss')).toBe('1 Zombie (TST) 7\n')
    expect(compareExportText(items, 'they_miss')).toBe('1 Angel (TST) 7\n2 Zombie (TST) 7\n')
  })

  it('lists the whole quantity for the buckets', () => {
    expect(compareExportText(items, 'neither')).toBe('2 Zombie (TST) 7\n')
    expect(compareExportText(items, 'only_me')).toBe('1 Angel (TST) 7\n')
    expect(compareExportText(items, 'only_them')).toBe('')
  })
})
