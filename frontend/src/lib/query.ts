/**
 * A subset of the Scryfall search syntax, evaluated locally against collection entries.
 * https://scryfall.com/docs/syntax
 */
import { isDoubleFaced, isLand, RARITY_ORDER } from './cards'
import type { Card, Entry } from './types'

export type Op = ':' | '=' | '!=' | '<' | '<=' | '>' | '>='

export type Node =
  | { type: 'and'; children: Node[] }
  | { type: 'or'; children: Node[] }
  | { type: 'not'; child: Node }
  | { type: 'term'; key: string; op: Op; value: string }
  | { type: 'name'; value: string; exact: boolean }

export interface ParseResult {
  node: Node | null
  errors: string[]
}

// --- tokenizer -------------------------------------------------------------------------------

type Token =
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'or' }
  | { t: 'neg' }
  | { t: 'word'; raw: string; quoted: boolean; exact: boolean }


function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const isSpace = (c: string) => /\s/.test(c)
  while (i < input.length) {
    const c = input[i]
    if (isSpace(c)) {
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ t: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ t: 'rp' })
      i++
      continue
    }
    if (c === '-' && i + 1 < input.length && !isSpace(input[i + 1])) {
      tokens.push({ t: 'neg' })
      i++
      continue
    }
    let exact = false
    if (c === '!' && input[i + 1] !== '=') {
      exact = true
      i++
    }
    // A word: runs until whitespace or parenthesis, but quoted sections may contain both.
    let raw = ''
    let quoted = false
    while (i < input.length && !isSpace(input[i]) && input[i] !== '(' && input[i] !== ')') {
      if (input[i] === '"') {
        quoted = true
        const end = input.indexOf('"', i + 1)
        const stop = end === -1 ? input.length : end
        raw += input.slice(i + 1, stop)
        i = stop + 1
      } else {
        raw += input[i]
        i++
      }
    }
    if (!quoted && raw.toUpperCase() === 'OR') tokens.push({ t: 'or' })
    else if (!quoted && raw.toUpperCase() === 'AND') continue
    else tokens.push({ t: 'word', raw, quoted, exact })
  }
  return tokens
}

// --- parser ----------------------------------------------------------------------------------

const KEY_RE = /^([a-zA-Z]+)(!=|<=|>=|:|=|<|>)(.*)$/s

export function parseQuery(input: string): ParseResult {
  const tokens = tokenize(input)
  const errors: string[] = []
  let pos = 0

  const parseOr = (): Node | null => {
    const parts: Node[] = []
    const first = parseAnd()
    if (first) parts.push(first)
    while (tokens[pos]?.t === 'or') {
      pos++
      const next = parseAnd()
      if (next) parts.push(next)
    }
    if (parts.length === 0) return null
    return parts.length === 1 ? parts[0] : { type: 'or', children: parts }
  }

  const parseAnd = (): Node | null => {
    const parts: Node[] = []
    while (pos < tokens.length && tokens[pos].t !== 'or' && tokens[pos].t !== 'rp') {
      const n = parseUnary()
      if (n) parts.push(n)
    }
    if (parts.length === 0) return null
    return parts.length === 1 ? parts[0] : { type: 'and', children: parts }
  }

  const parseUnary = (): Node | null => {
    const tok = tokens[pos++]
    if (tok.t === 'neg') {
      if (pos >= tokens.length) return null
      const child = parseUnary()
      return child ? { type: 'not', child } : null
    }
    if (tok.t === 'lp') {
      const inner = parseOr()
      if (tokens[pos]?.t === 'rp') pos++
      else errors.push('Parentesi non chiusa')
      return inner
    }
    if (tok.t === 'word') {
      const m = tok.quoted && !tok.raw.includes(':') ? null : KEY_RE.exec(tok.raw)
      if (m && !tok.exact) {
        const key = m[1].toLowerCase()
        if (!(key in MATCHERS)) {
          errors.push(`Filtro sconosciuto: ${m[1]}`)
          return null
        }
        return { type: 'term', key, op: m[2] as Op, value: m[3] }
      }
      return { type: 'name', value: tok.raw, exact: tok.exact }
    }
    return null
  }

  let node: Node | null = null
  while (pos < tokens.length) {
    const part = parseOr()
    if (tokens[pos]?.t === 'rp') {
      errors.push('Parentesi chiusa in più')
      pos++
    }
    if (part) node = node ? { type: 'and', children: [node, part] } : part
  }
  return { node, errors }
}

// --- matching --------------------------------------------------------------------------------

type Matcher = (e: Entry, op: Op, value: string) => boolean

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

function compare(a: number | null | undefined, op: Op, b: number): boolean {
  if (a == null || Number.isNaN(a) || Number.isNaN(b)) return false
  switch (op) {
    case ':':
    case '=':
      return a === b
    case '!=':
      return a !== b
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    case '>=':
      return a >= b
  }
}

const COLOR_NAMES: Record<string, string> = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', colorless: 'c',
  azorius: 'wu', dimir: 'ub', rakdos: 'br', gruul: 'rg', selesnya: 'gw',
  orzhov: 'wb', izzet: 'ur', golgari: 'bg', boros: 'rw', simic: 'gu',
  bant: 'gwu', esper: 'wub', grixis: 'ubr', jund: 'brg', naya: 'rgw',
  abzan: 'wbg', jeskai: 'urw', sultai: 'bgu', mardu: 'rwb', temur: 'gur',
  silverquill: 'wb', prismari: 'ur', witherbloom: 'bg', lorehold: 'rw', quandrix: 'gu',
  wubrg: 'wubrg', rainbow: 'wubrg',
}

function colorMatch(cardColors: string[], op: Op, raw: string, defaultOp: Op): boolean {
  const v = norm(raw)
  const have = new Set(cardColors.map((c) => c.toLowerCase()))
  if (/^\d+$/.test(v)) return compare(have.size, op === ':' ? '=' : op, Number(v))
  if (v === 'm' || v === 'multicolor' || v === 'multi') return op === '!=' ? have.size < 2 : have.size >= 2
  const letters = COLOR_NAMES[v] ?? v
  if (!/^[wubrgc]+$/.test(letters)) return false
  if (letters === 'c') {
    return op === '!=' ? have.size > 0 : have.size === 0
  }
  const want = new Set(letters.replace(/c/g, '').split(''))
  const effective = op === ':' ? defaultOp : op
  const subset = [...have].every((c) => want.has(c))
  const superset = [...want].every((c) => have.has(c))
  switch (effective) {
    case '=':
      return subset && superset
    case '!=':
      return !(subset && superset)
    case '>=':
      return superset
    case '>':
      return superset && have.size > want.size
    case '<=':
      return subset
    case '<':
      return subset && have.size < want.size
    default:
      return false
  }
}

/** Counts mana symbols: "{2}{U}{U}" or "2UU" → {generic: 2, U: 2}. */
export function manaSymbols(cost: string): Map<string, number> {
  const out = new Map<string, number>()
  const add = (k: string, n = 1) => out.set(k, (out.get(k) ?? 0) + n)
  const symbols = cost.includes('{') ? [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]) : cost.match(/\d+|[a-zA-Z]/g) ?? []
  for (const s of symbols) {
    const up = s.toUpperCase()
    if (/^\d+$/.test(up)) add('generic', Number(up))
    else add(up)
  }
  return out
}

function manaMatch(card: Card, op: Op, value: string): boolean {
  const want = manaSymbols(value)
  const costs = [card.mana_cost, ...card.faces.map((f) => f.mana_cost)].filter(Boolean)
  return costs.some((cost) => {
    const have = manaSymbols(cost)
    const contains = [...want].every(([k, n]) => (have.get(k) ?? 0) >= n)
    if (op === '=') return contains && [...have].every(([k, n]) => (want.get(k) ?? 0) === n)
    if (op === '!=') return !contains
    return contains
  })
}

const rarityRank = (r: string) => {
  const map: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic', s: 'special', b: 'bonus' }
  return RARITY_ORDER.indexOf(map[r] ?? r)
}

const text = (card: Card) => [card.oracle_text, ...card.faces.map((f) => f.oracle_text)].join('\n')

function numericOrStat(raw: string | null): number | null {
  if (raw == null) return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

const IS: Record<string, (e: Entry) => boolean> = {
  foil: (e) => e.rows.some((r) => r.finish === 'foil'),
  etched: (e) => e.rows.some((r) => r.finish === 'etched'),
  nonfoil: (e) => e.rows.some((r) => r.finish === 'normal'),
  dfc: (e) => isDoubleFaced(e.card),
  mdfc: (e) => e.card.layout === 'modal_dfc',
  transform: (e) => e.card.layout === 'transform',
  split: (e) => e.card.layout === 'split',
  adventure: (e) => e.card.layout === 'adventure',
  legendary: (e) => e.card.type_line.includes('Legendary'),
  commander: (e) =>
    (e.card.type_line.includes('Legendary') && e.card.type_line.includes('Creature')) ||
    /can be your commander/i.test(text(e.card)),
  permanent: (e) => !/\b(Instant|Sorcery)\b/.test(e.card.type_line.split(' // ')[0]),
  spell: (e) => !isLand(e.card),
  land: (e) => isLand(e.card),
  historic: (e) => /Legendary|Artifact|Saga/.test(e.card.type_line),
  vanilla: (e) => e.card.type_line.includes('Creature') && !text(e.card).trim(),
  multicolor: (e) => (e.card.colors ?? []).length > 1,
  colorless: (e) => (e.card.colors ?? []).length === 0,
  proxy: (e) => e.rows.some((r) => r.proxy === 1),
  signed: (e) => e.rows.some((r) => r.signed === 1),
  altered: (e) => e.rows.some((r) => r.altered === 1),
}

const isMatcher: Matcher = (e, op, v) => {
  const fn = IS[norm(v)]
  if (!fn) return false
  return op === '!=' ? !fn(e) : fn(e)
}

const stringIncludes = (hay: string, op: Op, v: string) => {
  const found = norm(hay).includes(norm(v))
  return op === '!=' ? !found : found
}

export const MATCHERS: Record<string, Matcher> = {
  c: (e, op, v) => colorMatch(e.card.colors ?? [], op, v, '>='),
  color: (e, op, v) => colorMatch(e.card.colors ?? [], op, v, '>='),
  id: (e, op, v) => colorMatch(e.card.color_identity, op, v, '<='),
  identity: (e, op, v) => colorMatch(e.card.color_identity, op, v, '<='),
  ci: (e, op, v) => colorMatch(e.card.color_identity, op, v, '<='),
  t: (e, op, v) => stringIncludes(e.card.type_line, op, v),
  type: (e, op, v) => stringIncludes(e.card.type_line, op, v),
  o: (e, op, v) => stringIncludes(text(e.card), op, v.replace(/~/g, e.card.name)),
  oracle: (e, op, v) => stringIncludes(text(e.card), op, v.replace(/~/g, e.card.name)),
  m: (e, op, v) => manaMatch(e.card, op, v),
  mana: (e, op, v) => manaMatch(e.card, op, v),
  mv: (e, op, v) => mvMatch(e.card.cmc, op, v),
  cmc: (e, op, v) => mvMatch(e.card.cmc, op, v),
  manavalue: (e, op, v) => mvMatch(e.card.cmc, op, v),
  pow: (e, op, v) => compare(numericOrStat(e.card.power), op, Number(v)),
  power: (e, op, v) => compare(numericOrStat(e.card.power), op, Number(v)),
  tou: (e, op, v) => compare(numericOrStat(e.card.toughness), op, Number(v)),
  toughness: (e, op, v) => compare(numericOrStat(e.card.toughness), op, Number(v)),
  loy: (e, op, v) => compare(numericOrStat(e.card.loyalty), op, Number(v)),
  loyalty: (e, op, v) => compare(numericOrStat(e.card.loyalty), op, Number(v)),
  r: (e, op, v) => rarityMatch(e, op, v),
  rarity: (e, op, v) => rarityMatch(e, op, v),
  s: (e, op, v) => setMatch(e, op, v),
  set: (e, op, v) => setMatch(e, op, v),
  e: (e, op, v) => setMatch(e, op, v),
  edition: (e, op, v) => setMatch(e, op, v),
  cn: (e, op, v) => {
    const found = e.rows.some((r) => r.collector_number === v)
    return op === '!=' ? !found : found
  },
  number: (e, op, v) => e.rows.some((r) => r.collector_number === v) !== (op === '!='),
  a: (e, op, v) => stringIncludes(e.card.artist ?? '', op, v),
  artist: (e, op, v) => stringIncludes(e.card.artist ?? '', op, v),
  kw: (e, op, v) => e.card.keywords.some((k) => norm(k).includes(norm(v))) !== (op === '!='),
  keyword: (e, op, v) => e.card.keywords.some((k) => norm(k).includes(norm(v))) !== (op === '!='),
  is: isMatcher,
  has: isMatcher,
  not: (e, op, v) => !isMatcher(e, op, v),
  f: (e, op, v) => e.card.legal.includes(norm(v)) !== (op === '!='),
  format: (e, op, v) => e.card.legal.includes(norm(v)) !== (op === '!='),
  legal: (e, op, v) => e.card.legal.includes(norm(v)) !== (op === '!='),
  eur: (e, op, v) => compare(e.unitMarket, op, Number(v.replace(',', '.'))),
  price: (e, op, v) => compare(e.unitMarket, op, Number(v.replace(',', '.'))),
  buy: (e, op, v) => compare(e.unitPurchase, op, Number(v.replace(',', '.'))),
  value: (e, op, v) => compare(e.marketValue, op, Number(v.replace(',', '.'))),
  qty: (e, op, v) => compare(e.quantity, op, Number(v)),
  quantity: (e, op, v) => compare(e.quantity, op, Number(v)),
  binder: (e, op, v) => e.binders.some((b) => norm(b).includes(norm(v))) !== (op === '!='),
  lang: (e, op, v) => e.rows.some((r) => norm(r.language ?? '') === norm(v)) !== (op === '!='),
  language: (e, op, v) => e.rows.some((r) => norm(r.language ?? '') === norm(v)) !== (op === '!='),
  year: (e, op, v) => compare(e.card.released_at ? Number(e.card.released_at.slice(0, 4)) : null, op, Number(v)),
  game: (e, op, v) => e.card.games.includes(norm(v)) !== (op === '!='),
}

function mvMatch(cmc: number, op: Op, v: string): boolean {
  const lv = v.toLowerCase()
  if (lv === 'even') return cmc % 2 === 0
  if (lv === 'odd') return cmc % 2 === 1
  return compare(cmc, op, Number(v))
}

function rarityMatch(e: Entry, op: Op, v: string): boolean {
  const want = rarityRank(norm(v))
  if (want < 0) return false
  const ranks = new Set([rarityRank(e.card.rarity), ...e.rows.map((r) => rarityRank(r.rarity ?? ''))])
  return [...ranks].some((rank) => rank >= 0 && compare(rank, op, want))
}

function setMatch(e: Entry, op: Op, v: string): boolean {
  const want = norm(v)
  const found = e.card.set === want || e.rows.some((r) => r.set_code.toLowerCase() === want)
  return op === '!=' ? !found : found
}

export function matches(node: Node | null, e: Entry): boolean {
  if (!node) return true
  switch (node.type) {
    case 'and':
      return node.children.every((c) => matches(c, e))
    case 'or':
      return node.children.some((c) => matches(c, e))
    case 'not':
      return !matches(node.child, e)
    case 'name': {
      const names = [e.card.name, ...e.card.faces.map((f) => f.name)]
      return node.exact
        ? names.some((n) => norm(n) === norm(node.value))
        : names.some((n) => norm(n).includes(norm(node.value)))
    }
    case 'term':
      return MATCHERS[node.key](e, node.op, node.value)
  }
}

export const QUERY_HELP: [string, string][] = [
  ['nome libero', 'parte del nome, oppure !"Nome esatto"'],
  ['c: / color:', 'colori: c:ub, c=r, c<=wu, c:m (multi), c:c (incolore), c:azorius'],
  ['id: / identity:', 'identità di colore (id:esper = al più W/U/B)'],
  ['t: / type:', 'tipo: t:creature, t:"legendary elf"'],
  ['o: / oracle:', 'testo: o:"draw a card", o:~ (nome della carta)'],
  ['m: / mana:', 'simboli di mana: m:{G}{G}, m=2UU'],
  ['mv: / cmc:', 'mana value: mv<=3, mv=0, mv:even'],
  ['pow: tou: loy:', 'forza, costituzione, fedeltà: pow>=4'],
  ['r: / rarity:', 'rarità: r:mythic, r>=rare'],
  ['s: / set:', 'codice espansione: s:mh1'],
  ['cn:', 'numero da collezione'],
  ['a: / kw:', 'artista, keyword: kw:flying'],
  ['f: / format:', 'legalità: f:pauper, f:commander'],
  ['is: / not:', 'foil, etched, dfc, mdfc, legendary, commander, permanent, vanilla, proxy…'],
  ['eur: buy: value:', 'prezzo di mercato, d’acquisto, valore totale: eur>=5'],
  ['qty: binder: lang:', 'copie, binder, lingua: qty>1, binder:"binder A", lang:it'],
  ['year: game:', 'anno di uscita, gioco: year>=2020, game:arena'],
  ['OR, -, ( )', 'alternative, negazione, raggruppamento: (t:instant OR t:sorcery) -c:r'],
]
