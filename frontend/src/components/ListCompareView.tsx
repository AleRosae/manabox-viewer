import clsx from 'clsx'
import { Copy, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { fmtEur, marketPrice } from '../lib/cards'
import {
  COMPARE_LABEL,
  COMPARE_ORDER,
  compareBucket,
  compareExportText,
  compareSummary,
  filterCopies,
  inFilter,
  missingMine,
  missingTheirs,
  type CompareFilter,
} from '../lib/compare'
import type { ListItem } from '../lib/types'
import { useUsdRate } from '../store/data'
import { useHoverPreview } from './HoverPreview'

type Filter = CompareFilter

/** The Clipboard API exists only on HTTPS and localhost: over plain HTTP on the LAN fall back to a selection copy. */
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy refused')
  } finally {
    area.remove()
  }
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'list'

function Count({ have, of }: { have: number | null; of: number }) {
  if (have == null) return <span className="text-dim">?</span>
  const n = Math.min(have, of)
  return <span className={clsx('font-mono', n >= of ? 'text-ok' : n > 0 ? 'text-accent' : 'text-bad')}>{n}/{of}</span>
}

function CompareRow({ item, price, them, onOpen }: { item: ListItem; price: number; them: string; onOpen: () => void }) {
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
      <td className="hidden px-2 text-xs text-muted sm:table-cell">{bucket === 'only_them' ? `Only ${them}` : bucket ? COMPARE_LABEL[bucket] : 'Unknown'}</td>
      <td className="py-1.5 pl-2 pr-4 text-right font-mono text-xs text-muted">{fmtEur(price)}</td>
    </tr>
  )
}

/**
 * Side-by-side ownership: what each of us has and misses. The other side is whoever shared the list,
 * or CubeCobra's statuses for a linked cube (`their_owned` holds their copies).
 */
export function ListCompareView({
  items,
  listName,
  sharedBy,
  note,
  onOpen,
}: {
  items: ListItem[]
  listName: string
  sharedBy: string | null
  /** what "their" ownership means, under their counts */
  note: string
  onOpen: (item: ListItem) => void
}) {
  const rate = useUsdRate()
  const them = sharedBy || 'Them'
  const [filter, setFilter] = useState<Filter>('all')
  const price = (i: ListItem) => marketPrice(i.card, 'normal', rate) ?? 0
  const summary = useMemo(() => compareSummary(items, (i) => marketPrice(i.card, 'normal', rate) ?? 0), [items, rate])

  const shown = useMemo(() => {
    return items.filter((i) => inFilter(i, filter)).sort((a, b) => a.card.name.localeCompare(b.card.name))
  }, [items, filter])

  const chips: [Filter, string, number][] = [
    ['all', 'All', items.length],
    ['you_miss', "You're missing", items.filter((i) => missingMine(i) > 0).length],
    ['they_miss', `${them} ${sharedBy ? 'is' : 'are'} missing`, items.filter((i) => missingTheirs(i) > 0).length],
    ...COMPARE_ORDER.map((b): [Filter, string, number] => [b, b === 'only_them' ? `Only ${sharedBy || 'them'}` : COMPARE_LABEL[b], summary.counts[b]]),
  ]

  const exportText = () => compareExportText(items, filter)
  const copyList = async () => {
    try {
      await copyText(exportText())
      const copies = shown.reduce((n, i) => n + filterCopies(i, filter), 0)
      toast.success(`Copied ${copies} ${copies === 1 ? 'copy' : 'copies'} (${shown.length} ${shown.length === 1 ? 'card' : 'cards'})`)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }
  const downloadList = () => {
    const url = URL.createObjectURL(new Blob([exportText()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(listName)}_${filter}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoking right away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

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
          <span className="text-xs text-dim">{note}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter comparison" className="flex flex-wrap gap-1.5">
          {chips.map(([k, label, n]) => (
            <button key={k} type="button" aria-pressed={filter === k} className={clsx('min-h-[34px] rounded-full border px-3 text-[12.5px] font-medium', filter === k ? 'border-[#3A3F4B] bg-chip text-fg' : 'border-line-2 text-muted hover:text-fg')} onClick={() => setFilter(k)}>
              {label} {n}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn" disabled={shown.length === 0} onClick={copyList} title="Copy these cards as “1 Name (SET) 123” lines; missing filters list only the missing copies">
            <Copy size={15} /> Copy
          </button>
          <button type="button" className="btn" disabled={shown.length === 0} onClick={downloadList} title="Download these cards as a .txt list; missing filters list only the missing copies">
            <Download size={15} /> .txt
          </button>
        </div>
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
                <CompareRow key={i.id} item={i} price={price(i)} them={sharedBy || 'them'} onOpen={() => onOpen(i)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
