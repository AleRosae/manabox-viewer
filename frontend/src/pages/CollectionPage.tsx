import clsx from 'clsx'
import { CheckSquare, LayoutGrid, List as ListIcon, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CardDetailDrawer } from '../components/CardDetailDrawer'
import { CollectionGrid } from '../components/CollectionGrid'
import { CollectionTable } from '../components/CollectionTable'
import { FilterPanel } from '../components/FilterPanel'
import { ScopeTabs } from '../components/ScopeTabs'
import { SearchBar } from '../components/SearchBar'
import { SelectionBar } from '../components/SelectionBar'
import { buildEntries, fmtEur, fmtNum } from '../lib/cards'
import { activeFilterCount, EMPTY_FILTERS, matchesPanel, SORT_LABELS, sortEntries, type PanelFilters, type SortDir, type SortKey } from '../lib/filters'
import { matches, parseQuery } from '../lib/query'
import { useData, useUsdRate } from '../store/data'
import { useDetail, useSelection } from '../store/ui'

function readFilters(raw: string | null): PanelFilters {
  if (!raw) return EMPTY_FILTERS
  try {
    return { ...EMPTY_FILTERS, ...JSON.parse(raw) }
  } catch {
    return EMPTY_FILTERS
  }
}

export function CollectionPage() {
  const collection = useData((s) => s.collection)
  const rate = useUsdRate()
  const [params, setParams] = useSearchParams()
  const [showFilters, setShowFilters] = useState(false)

  const scope = params.get('scope') ?? 'all'
  const q = params.get('q') ?? ''
  const filtersRaw = params.get('f')
  const filters = useMemo(() => readFilters(filtersRaw), [filtersRaw])
  const sort = (params.get('sort') as SortKey) ?? 'price'
  const dir = (params.get('dir') as SortDir) ?? (sort === 'name' ? 'asc' : 'desc')
  const view = params.get('view') === 'table' ? 'table' : 'grid'

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const setQuery = useCallback((v: string) => update({ q: v }), [update])
  const setFilters = (f: PanelFilters) => update({ f: activeFilterCount(f) ? JSON.stringify(f) : null })
  const setSort = (key: SortKey) => {
    const nextDir: SortDir = key === sort ? (dir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'set' ? 'asc' : 'desc'
    update({ sort: key, dir: nextDir })
  }

  const scoped = useMemo(
    () => (collection ? buildEntries(collection.rows, collection.cards, scope, rate) : []),
    [collection, scope, rate],
  )
  const parsed = useMemo(() => parseQuery(q), [q])
  const queried = useMemo(() => scoped.filter((e) => matches(parsed.node, e)), [scoped, parsed])
  const visible = useMemo(
    () => sortEntries(queried.filter((e) => matchesPanel(e, filters)), sort, dir),
    [queried, filters, sort, dir],
  )
  const totals = useMemo(
    () => ({
      copies: visible.reduce((n, e) => n + e.quantity, 0),
      value: visible.reduce((n, e) => n + e.marketValue, 0),
    }),
    [visible],
  )

  // The selection belongs to the current result set: reset it when filters or scope change.
  const { selected, mode, toggle, selectRange, setMode, clear } = useSelection()
  useEffect(() => {
    clear()
  }, [scope, q, filtersRaw, clear])
  useEffect(() => () => setMode(false), [setMode])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useSelection.getState().mode) setMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  const visibleKeys = useMemo(() => visible.map((e) => e.key), [visible])
  const onSelect = useCallback(
    (key: string, index: number, shift: boolean) => (shift ? selectRange(visibleKeys, index) : toggle(key, index)),
    [selectRange, toggle, visibleKeys],
  )

  const { entryKey, open, close } = useDetail()
  const detailCard = entryKey ? (scoped.find((e) => e.key === entryKey)?.card ?? null) : null

  if (!collection) return null
  const filterCount = activeFilterCount(filters)
  const selectionMode = mode || selected.size > 0

  return (
    <div className="flex flex-1 flex-wrap">
      <aside
        className={clsx(
          'w-full border-line bg-side px-[22px] pb-10 pt-[22px] lg:sticky lg:top-[69px] lg:block lg:max-h-[calc(100vh-69px)] lg:w-[290px] lg:overflow-y-auto lg:border-r',
          showFilters ? 'block border-b' : 'hidden',
        )}
      >
        <FilterPanel filters={filters} onChange={setFilters} entries={queried} />
      </aside>

      <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-[18px] px-4 pb-12 pt-[22px] sm:px-7">
        <ScopeTabs scope={scope} onChange={(s) => update({ scope: s === 'all' ? null : s })} />

        <SearchBar value={q} onChange={setQuery} errors={parsed.errors} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted">
            <span className="font-semibold text-fg">
              {fmtNum(visible.length)} {scope === 'all' ? 'carte uniche' : 'carte'}
            </span>{' '}
            · {fmtNum(totals.copies)} copie · <span className="font-mono">{fmtEur(totals.value)}</span> mercato
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" className="btn lg:hidden" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              <SlidersHorizontal size={15} /> Filtri{filterCount > 0 && ` (${filterCount})`}
            </button>
            <button
              type="button"
              aria-pressed={selectionMode}
              className={clsx('btn', selectionMode && 'border-accent bg-warn-bg text-warn-fg hover:bg-warn-bg')}
              onClick={() => setMode(!selectionMode)}
            >
              <CheckSquare size={15} /> Selezione
            </button>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Ordina
              <select className="field" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {Object.entries(SORT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-icon" aria-label={dir === 'asc' ? 'Crescente' : 'Decrescente'} onClick={() => update({ dir: dir === 'asc' ? 'desc' : 'asc' })}>
              {dir === 'asc' ? '↑' : '↓'}
            </button>
            <div role="group" aria-label="Vista" className="flex rounded-[9px] border border-line bg-[#15171D] p-[3px]">
              <button type="button" aria-label="Griglia" aria-pressed={view === 'grid'} className={clsx('seg px-2.5', view === 'grid' && 'seg-on')} onClick={() => update({ view: null })}>
                <LayoutGrid size={16} />
              </button>
              <button type="button" aria-label="Tabella" aria-pressed={view === 'table'} className={clsx('seg px-2.5', view === 'table' && 'seg-on')} onClick={() => update({ view: 'table' })}>
                <ListIcon size={16} />
              </button>
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="text-base font-semibold">Nessuna carta corrisponde</span>
            <span className="text-sm text-muted">Prova a togliere qualche filtro o a cambiare la ricerca.</span>
          </div>
        ) : view === 'grid' ? (
          <CollectionGrid entries={visible} selected={selected} selectionMode={selectionMode} showBinders={scope === 'all'} onSelect={onSelect} onOpen={open} />
        ) : (
          <CollectionTable entries={visible} selected={selected} selectionMode={selectionMode} sort={sort} dir={dir} onSort={setSort} onSelect={onSelect} onOpen={open} />
        )}

        <SelectionBar visible={visible} />
      </main>

      <CardDetailDrawer card={detailCard} onClose={close} />
    </div>
  )
}
