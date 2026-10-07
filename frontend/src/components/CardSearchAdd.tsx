import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { addToList } from '../lib/listActions'
import { useCollectionIndex, useData } from '../store/data'

interface Option {
  name: string
  owned: number
  binders: string[]
}

/** "Add card" field for lists: collection cards first, then any card from Scryfall. */
export function CardSearchAdd({ listId }: { listId: number }) {
  const index = useCollectionIndex()
  const collection = useData((s) => s.collection)
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setRemote([])
      return
    }
    const t = window.setTimeout(() => {
      api.autocomplete(term).then(setRemote, () => setRemote([]))
    }, 250)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const options = useMemo<Option[]>(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2 || !index || !collection) return []
    const describe = (name: string): Option => {
      const oracle = index.oracleByName.get(name.toLowerCase())
      const rows = oracle ? (index.rowsByOracle.get(oracle) ?? []) : []
      return {
        name,
        owned: oracle ? (index.ownedByOracle.get(oracle) ?? 0) : 0,
        binders: [...new Set(rows.map((r) => r.binder_name))],
      }
    }
    const local: Option[] = []
    for (const [lname, oracle] of index.oracleByName) {
      if (!lname.includes(term)) continue
      const row = index.rowsByOracle.get(oracle)?.[0]
      const card = row?.scryfall_id ? collection.cards[row.scryfall_id] : undefined
      if (card) local.push(describe(card.name))
      if (local.length >= 5) break
    }
    const seen = new Set(local.map((o) => o.name.toLowerCase()))
    const others = remote.filter((n) => !seen.has(n.toLowerCase())).slice(0, 8).map(describe)
    return [...local, ...others]
  }, [q, remote, index, collection])

  const choose = async (opt: Option) => {
    setBusy(true)
    try {
      const oracle = index?.oracleByName.get(opt.name.toLowerCase())
      const scryfallId = oracle ? index?.bestPrintByOracle.get(oracle) : (await api.named(opt.name)).id
      if (!scryfallId) throw new Error('carta non trovata')
      await addToList(listId, [{ scryfall_id: scryfallId, quantity: 1 }])
      setQ('')
      setOpen(false)
    } catch (err) {
      toast.error(`Impossibile aggiungere ${opt.name}: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={boxRef} className="relative min-w-0 max-w-[520px] flex-[1_1_360px]">
      <label className={clsx('flex min-h-11 items-center gap-2.5 rounded-[10px] border bg-[#15171D] px-3.5', open && options.length ? 'border-accent' : 'border-line-3')}>
        <Plus size={16} className="text-muted" />
        <input
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls="card-search-options"
          aria-label="Aggiungi carta alla lista"
          placeholder="Aggiungi carta…"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-dim"
          value={q}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(options.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && options[active]) {
              e.preventDefault()
              void choose(options[active])
            } else if (e.key === 'Escape') setOpen(false)
          }}
        />
        <span className="hidden text-[11.5px] text-dim sm:inline">collezione + Scryfall</span>
      </label>
      {open && options.length > 0 && (
        <ul id="card-search-options" role="listbox" className="absolute inset-x-0 top-[50px] z-30 m-0 flex list-none flex-col gap-0.5 rounded-xl border border-line-3 bg-raised p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.6)]">
          {options.map((o, i) => (
            <li
              key={o.name}
              role="option"
              aria-selected={i === active}
              className={clsx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13.5px]', i === active && 'bg-chip')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                void choose(o)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.owned > 0 ? (
                <span className="pill bg-[#1F3A2A] text-[#8FDCA9]">
                  {o.owned}× · {o.binders.join(', ')}
                </span>
              ) : (
                <span className="pill bg-[#2A2D35] text-muted">NON POSSEDUTA</span>
              )}
            </li>
          ))}
          <li className="mt-1 border-t border-line-2 px-3 pb-1 pt-2 text-[11.5px] text-dim">
            Invio per aggiungere · le carte non possedute restano solo in questa lista
          </li>
        </ul>
      )}
    </div>
  )
}
