import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { fmtEur, marketPrice } from '../lib/cards'
import { COMPARE_LABEL, COMPARE_ORDER, compareBucket, compareSummary, missingMine, missingTheirs, type CompareBucket } from '../lib/compare'
import type { ListItem } from '../lib/types'
import { useUsdRate } from '../store/data'
import { useHoverPreview } from './HoverPreview'

type Filter = 'all' | 'you_miss' | 'they_miss' | CompareBucket

function Count({ have, of }: { have: number | null; of: number }) {
  if (have == null) return <span className="text-dim">?</span>
  const n = Math.min(have, of)
  return <span className={clsx('font-mono', n >= of ? 'text-ok' : n > 0 ? 'text-accent' : 'text-bad')}>{n}/{of}</span>
}

function CompareRow({ item, price, onOpen }: { item: ListItem; price: number; onOpen: () => void }) {
  const hover = useHoverPreview(item.card, item.ownership === 'not_owned')
  const bucket = compareBucket(item)
  return (
    <tr className="border-t border-line hover:bg-panel-2">
      <td className="max-w-0 py-1.5 pl-4 pr-2">
        <button type="button" className="block w-full truncate text-left" onClick={onOpen} {...hover}>
          {item.card.name}
        </button>
      </td>
      <td className="px-2 text-right font-mono text-dim">{item.quantity}</td>
      <td className="px-2 text-right"><Count have={item.owned} of={item.quantity} /></td>
      <td className="px-2 text-right"><Count have={item.their_owned} of={item.quantity} /></td>
      <td className="hidden px-2 text-xs text-muted sm:table-cell">{bucket ? COMPARE_LABEL[bucket] : 'Unknown'}</td>
      <td className="py-1.5 pl-2 pr-4 text-right font-mono text-xs text-muted">{fmtEur(price)}</td>
    </tr>
  )
}

/** Side-by-side ownership of a shared list: what each of us has and misses. */
export function ListCompareView({ items, sharedBy, onOpen }: { items: ListItem[]; sharedBy: string | null; onOpen: (item: ListItem) => void }) {
  const rate = useUsdRate()
  const them = sharedBy || 'Them'
  const [filter, setFilter] = useState<Filter>('all')
  const price = (i: ListItem) => marketPrice(i.card, 'normal', rate) ?? 0
  const summary = useMemo(() => compareSummary(items, (i) => marketPrice(i.card, 'normal', rate) ?? 0), [items, rate])

  const shown = useMemo(() => {
    const keep = (i: ListItem) =>
      filter === 'all' ? true : filter === 'you_miss' ? missingMine(i) > 0 : filter === 'they_miss' ? missingTheirs(i) > 0 : compareBucket(i) === filter
    return items.filter(keep).sort((a, b) => a.card.name.localeCompare(b.card.name))
  }, [items, filter])

  const chips: [Filter, string, number][] = [
    ['all', 'All', items.length],
    ['you_miss', "You're missing", items.filter((i) => missingMine(i) > 0).length],
    ['they_miss', `${them} ${sharedBy ? 'is' : 'are'} missing`, items.filter((i) => missingTheirs(i) > 0).length],
    ...COMPARE_ORDER.map((b): [Filter, string, number] => [b, b === 'only_them' ? `Only ${sharedBy || 'them'}` : COMPARE_LABEL[b], summary.counts[b]]),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <div className="panel flex flex-col gap-1 px-4 py-3">
          <span className="text-xs text-muted">You're missing</span>
          <span className="font-mono text-lg">{summary.youMiss} copies</span>
          <span className="text-xs text-dim">{fmtEur(summary.youMissValue)} at market</span>
        </div>
        <div className="panel flex flex-col gap-1 px-4 py-3">
          <span className="text-xs text-muted">{them} {sharedBy ? 'is' : 'are'} missing</span>
          <span className="font-mono text-lg">{summary.theyMiss} copies</span>
          <span className="text-xs text-dim">{fmtEur(summary.theyMissValue)} at market</span>
        </div>
        <div className="panel flex flex-col gap-1 px-4 py-3">
          <span className="text-xs text-muted">Cards only you have</span>
          <span className="font-mono text-lg">{summary.counts.only_me}</span>
          <span className="text-xs text-dim">{summary.counts.both} both · {summary.counts.neither} neither</span>
        </div>
        <div className="panel flex flex-col gap-1 px-4 py-3">
          <span className="text-xs text-muted">Cards only {sharedBy || 'they'} {sharedBy ? 'has' : 'have'}</span>
          <span className="font-mono text-lg">{summary.counts.only_them}</span>
          <span className="text-xs text-dim">ownership as of their export</span>
        </div>
      </div>

      <div role="group" aria-label="Filter comparison" className="flex flex-wrap gap-1.5">
        {chips.map(([k, label, n]) => (
          <button key={k} type="button" aria-pressed={filter === k} className={clsx('min-h-[34px] rounded-full border px-3 text-[12.5px] font-medium', filter === k ? 'border-[#3A3F4B] bg-chip text-fg' : 'border-line-2 text-muted hover:text-fg')} onClick={() => setFilter(k)}>
            {label} {n}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="panel px-6 py-10 text-center text-sm text-muted">No cards match this filter.</div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full table-fixed border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-xs text-dim">
                <th className="py-2.5 pl-4 pr-2 font-medium">Card</th>
                <th className="w-12 px-2 text-right font-medium">Qty</th>
                <th className="w-16 px-2 text-right font-medium">You</th>
                <th className="w-20 truncate px-2 text-right font-medium">{them}</th>
                <th className="hidden w-24 px-2 font-medium sm:table-cell">Status</th>
                <th className="w-24 py-2.5 pl-2 pr-4 text-right font-medium">€ each</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <CompareRow key={i.id} item={i} price={price(i)} onOpen={() => onOpen(i)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
