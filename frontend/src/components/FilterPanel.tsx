import clsx from 'clsx'
import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MAIN_TYPES } from '../lib/cards'
import { EMPTY_FILTERS, type ColorMode, type PanelFilters } from '../lib/filters'
import type { Entry } from '../lib/types'

const COLORS = [
  { k: 'W', label: 'Bianco', bg: '#F0E6C8', fg: '#3A3320' },
  { k: 'U', label: 'Blu', bg: '#4A90D9', fg: '#fff' },
  { k: 'B', label: 'Nero', bg: '#4B4150', fg: '#fff' },
  { k: 'R', label: 'Rosso', bg: '#C9503A', fg: '#fff' },
  { k: 'G', label: 'Verde', bg: '#3E8E5E', fg: '#fff' },
  { k: 'C', label: 'Incolore', bg: '#6B7079', fg: '#fff' },
]

const RARITIES = [
  { k: 'common', label: 'Common', dot: '#5A5F68' },
  { k: 'uncommon', label: 'Uncommon', dot: '#A9B4C2' },
  { k: 'rare', label: 'Rare', dot: '#D9B45A' },
  { k: 'mythic', label: 'Mythic', dot: '#E0703A' },
  { k: 'special', label: 'Special', dot: '#9C7FD1' },
]

const TYPE_LABELS: Record<string, string> = {
  Creature: 'Creature', Instant: 'Instant', Sorcery: 'Sorcery', Artifact: 'Artifact',
  Enchantment: 'Enchantment', Planeswalker: 'Planeswalker', Battle: 'Battle', Land: 'Land',
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number }) {
  return (
    <label className="flex flex-col rounded-[9px] border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-dim focus-within:border-accent">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        placeholder="—"
        className="w-full bg-transparent font-mono text-sm text-fg outline-none"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  )
}

interface Props {
  filters: PanelFilters
  onChange: (f: PanelFilters) => void
  /** entries before panel filtering, used for facet counts and the set list */
  entries: Entry[]
}

export function FilterPanel({ filters: f, onChange, entries }: Props) {
  const [setQuery, setSetQuery] = useState('')
  const set = (patch: Partial<PanelFilters>) => onChange({ ...f, ...patch })

  const { typeCounts, sets } = useMemo(() => {
    const typeCounts = new Map<string, number>()
    const sets = new Map<string, { name: string; count: number }>()
    for (const e of entries) {
      const front = e.card.type_line.split(' // ')[0]
      for (const t of MAIN_TYPES) if (front.includes(t)) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
      for (const r of e.rows) {
        const code = r.set_code.toLowerCase()
        const s = sets.get(code) ?? { name: code === e.card.set ? e.card.set_name : r.set_code, count: 0 }
        s.count += r.quantity
        sets.set(code, s)
      }
    }
    return { typeCounts, sets: [...sets.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)) }
  }, [entries])

  const setMatches = setQuery
    ? sets.filter(([code, s]) => code.includes(setQuery.toLowerCase()) || s.name.toLowerCase().includes(setQuery.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">Filtri</span>
        <button type="button" className="text-xs text-accent hover:text-accent-hi" onClick={() => onChange(EMPTY_FILTERS)}>
          Azzera
        </button>
      </div>

      <section className="flex flex-col gap-2.5">
        <h3 className="facet">Colore</h3>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => {
            const on = f.colors.includes(c.k)
            return (
              <button
                key={c.k}
                type="button"
                aria-label={c.label}
                aria-pressed={on}
                className={clsx('h-[34px] w-[34px] rounded-full border-2 font-mono text-[13px] font-bold transition-[border-color,opacity]', on ? 'border-fg' : 'border-transparent opacity-70 hover:opacity-100')}
                style={{ background: c.bg, color: c.fg }}
                onClick={() => set({ colors: toggle(f.colors, c.k) })}
              >
                {c.k}
              </button>
            )
          })}
        </div>
        <div className="flex rounded-[9px] border border-line bg-panel-2 p-[3px]" role="group" aria-label="Modalità colore">
          {(['include', 'atmost', 'exact'] as ColorMode[]).map((m) => (
            <button key={m} type="button" className={clsx('seg flex-1 px-2', f.colorMode === m && 'seg-on')} onClick={() => set({ colorMode: m })}>
              {m === 'include' ? 'Include' : m === 'atmost' ? 'Al più' : 'Esatti'}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="facet">Mana value</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="min" value={f.mvMin} onChange={(v) => set({ mvMin: v })} />
          <NumberField label="max" value={f.mvMax} onChange={(v) => set({ mvMax: v })} />
        </div>
      </section>

      <section className="flex flex-col gap-0.5">
        <h3 className="facet mb-1.5">Tipo</h3>
        {MAIN_TYPES.filter((t) => typeCounts.has(t)).map((t) => (
          <label key={t} className="flex min-h-7 cursor-pointer items-center gap-2 text-[13px] text-soft">
            <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={f.types.includes(t)} onChange={() => set({ types: toggle(f.types, t) })} />
            {TYPE_LABELS[t]}
            <span className="ml-auto font-mono text-xs text-[#6B7079]">{typeCounts.get(t)}</span>
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-0.5">
        <h3 className="facet mb-1.5">Rarità</h3>
        {RARITIES.map((r) => (
          <label key={r.k} className="flex min-h-7 cursor-pointer items-center gap-2 text-[13px] text-soft">
            <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={f.rarities.includes(r.k)} onChange={() => set({ rarities: toggle(f.rarities, r.k) })} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.dot }} />
            {r.label}
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="facet">Espansione</h3>
        <div className="relative">
          <label className="flex min-h-10 items-center gap-2 rounded-[9px] border border-line bg-panel-2 px-3 text-dim focus-within:border-accent">
            <Search size={14} />
            <input
              placeholder={`Cerca tra ${sets.length} set…`}
              className="flex-1 bg-transparent text-[13px] text-fg outline-none"
              value={setQuery}
              onChange={(e) => setSetQuery(e.target.value)}
            />
          </label>
          {setMatches.length > 0 && (
            <ul className="absolute inset-x-0 top-11 z-20 rounded-lg border border-line-3 bg-raised p-1 shadow-xl">
              {setMatches.map(([code, s]) => (
                <li key={code}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-chip"
                    onClick={() => {
                      set({ sets: f.sets.includes(code) ? f.sets : [...f.sets, code] })
                      setSetQuery('')
                    }}
                  >
                    <span className="w-10 font-mono text-xs text-dim">{code.toUpperCase()}</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="font-mono text-xs text-dim">{s.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {f.sets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {f.sets.map((code) => (
              <button key={code} type="button" className="flex items-center gap-1 rounded-md bg-chip px-2 py-1 font-mono text-xs hover:bg-line-3" onClick={() => set({ sets: f.sets.filter((s) => s !== code) })} aria-label={`Rimuovi ${code}`}>
                {code.toUpperCase()} <X size={12} />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="facet">Prezzo di mercato (€)</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="min €" value={f.priceMin} step={0.5} onChange={(v) => set({ priceMin: v })} />
          <NumberField label="max €" value={f.priceMax} step={0.5} onChange={(v) => set({ priceMax: v })} />
        </div>
      </section>

      <section className="flex flex-col gap-0.5">
        <h3 className="facet mb-1.5">Finitura e forma</h3>
        <label className="flex min-h-7 cursor-pointer items-center gap-2 text-[13px] text-soft">
          <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={f.foilOnly} onChange={() => set({ foilOnly: !f.foilOnly })} />
          Solo foil / etched
        </label>
        <label className="flex min-h-7 cursor-pointer items-center gap-2 text-[13px] text-soft">
          <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={f.dfcOnly} onChange={() => set({ dfcOnly: !f.dfcOnly })} />
          Solo bifronte
        </label>
      </section>
    </div>
  )
}
