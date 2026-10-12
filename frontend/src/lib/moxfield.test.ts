import { describe, expect, it } from 'vitest'
import { bookmarklet, parseDeckJson } from './moxfield'

describe('moxfield', () => {
  it('builds a bookmarklet that is valid JavaScript and talks only to the app', () => {
    const url = bookmarklet('http://localhost:8080')
    expect(url.startsWith('javascript:')).toBe(true)
    const code = decodeURIComponent(url.slice('javascript:'.length))
    expect(() => new Function(code)).not.toThrow()
    expect(code).toContain('const APP="http://localhost:8080"')
    expect(code).toContain('e.origin===APP')
  })

  it('reads a deck pasted as JSON, and nothing else', () => {
    const deck = { id: 'abc123', name: 'Krenko', format: 'commander', boards: { mainboard: [] } }
    expect(parseDeckJson(JSON.stringify(deck))).toEqual(deck)
    expect(parseDeckJson('1 Sol Ring')).toBeNull()
    expect(parseDeckJson('{"name": "no id"}')).toBeNull()
    expect(parseDeckJson('{broken')).toBeNull()
  })
})
