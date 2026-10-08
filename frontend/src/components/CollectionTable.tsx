import { useWindowVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { fmtEur } from '../lib/cards'
import type { SortDir, SortKey } from '../lib/filters'
import type { Entry } from '../lib/types'
import { useHoverPreview } from './HoverPreview'
import { ManaCost } from './ManaCost'

const ROW = 44
const COLS = 'grid-cols-[40px_minmax(180px,2.2fr)_minmax(120px,1.6fr)_70px_90px_44px_52px_minmax(90px,1fr)_84px_84px]'

interface Props {
  entries: Entry[]
  selected: Set<string>
  selectionMode: boolean
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  onSelect: (key: string, index: number, shift: boolean) => void
  onOpen: (key: string) => void
}

function Header({ label, k, sort, dir, onSort, right }: { label: string; k?: SortKey; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void; right?: boolean }) {
  if (!k) return <span className={clsx('px-2', right && 'text-right')}>{label}</span>
  const active = sort === k
  return (
    <button
      type="button"
      className={clsx('flex min-h-9 items-center gap-1 px-2 font-medium hover:text-fg', right && 'justify-end', active && 'text-fg')}
      onClick={() => onSort(k)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}
      {active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  )
}

function TableRow({ entry, index, selected, selectionMode, onSelect, onOpen }: { entry: Entry; index: number; selected: boolean; selectionMode: boolean; onSelect: Props['onSelect']; onOpen: Props['onOpen'] }) {
  const hover = useHoverPreview(entry.card)
  return (
    <div
      className={clsx(
        'grid h-full cursor-pointer items-center border-t border-line text-[13px] hover:bg-panel-2',
        COLS,
        selected && 'bg-warn-bg/60 hover:bg-warn-bg',
      )}
      onClick={(e) => {
        if (selectionMode || e.shiftKey || e.metaKey || e.ctrlKey) onSelect(entry.key, index, e.shiftKey)
        else onOpen(entry.key)
      }}
    >
      <label className="flex h-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={selected}
          aria-label={`Select ${entry.card.name}`}
          onChange={(e) => onSelect(entry.key, index, (e.nativeEvent as MouseEvent).shiftKey)}
        />
      </label>
      <span className="flex min-w-0 items-center gap-2 px-2" {...hover}>
        <span className="truncate font-medium">{entry.card.name}</span>
        <ManaCost cost={entry.card.mana_cost} size={14} className="shrink-0" />
      </span>
      <span className="truncate px-2 text-muted">{entry.card.type_line}</span>
      <span className="px-2 font-mono text-xs text-muted">{entry.card.set.toUpperCase()}</span>
      <span className="px-2 text-xs capitalize text-muted">{entry.card.rarity}</span>
      <span className="px-2 text-right font-mono">{entry.card.cmc}</span>
      <span className="px-2 text-right font-mono">{entry.quantity}</span>
      <span className="truncate px-2 text-xs text-muted">{entry.binders.join(', ')}</span>
      <span className="px-2 text-right font-mono text-muted">{fmtEur(entry.unitPurchase)}</span>
      <span className="px-2 text-right font-mono">{fmtEur(entry.unitMarket)}</span>
    </div>
  )
}

export function CollectionTable({ entries, selected, selectionMode, sort, dir, onSort, onSelect, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => {
    const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY
    if (Math.abs(top - offset) > 1) setOffset(top)
  })
  const virtualizer = useWindowVirtualizer({ count: entries.length, estimateSize: () => ROW, overscan: 12, scrollMargin: offset })
  const h = { sort, dir, onSort }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <div className="min-w-[980px]">
        <div className={clsx('sticky top-0 z-10 grid items-center bg-panel-2 text-xs text-dim', COLS)}>
          <span />
          <Header label="Name" k="name" {...h} />
          <Header label="Type" {...h} />
          <Header label="Set" k="set" {...h} />
          <Header label="Rarity" k="rarity" {...h} />
          <Header label="MV" k="mv" right {...h} />
          <Header label="Qty" k="qty" right {...h} />
          <Header label="Binder" {...h} />
          <Header label="€ paid" right {...h} />
          <Header label="€ market" k="price" right {...h} />
        </div>
        <div ref={ref} className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const entry = entries[v.index]
            return (
              <div key={entry.key} className="absolute inset-x-0 top-0" style={{ height: ROW, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
                <TableRow entry={entry} index={v.index} selected={selected.has(entry.key)} selectionMode={selectionMode} onSelect={onSelect} onOpen={onOpen} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
