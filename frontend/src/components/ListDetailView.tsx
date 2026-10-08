import * as Popover from '@radix-ui/react-popover'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, Download, ExternalLink, LayoutGrid, Link2, Minus, Pencil, Plus, RefreshCw, Rows3, Share2, Tag, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { BUCKET_COLOR, BUCKET_LABEL, fmtEur, fmtNum, isLand, marketPrice } from '../lib/cards'
import { hasComparison } from '../lib/compare'
import { GROUP_LABEL, type GroupBy, groupItems, hasTag, listTags } from '../lib/listGroups'
import { computeStats } from '../lib/stats'
import type { ListDetail, ListItem } from '../lib/types'
import { useData, useUsdRate } from '../store/data'
import { CardDetailDrawer } from './CardDetailDrawer'
import { CardImage } from './CardImage'
import { CardSearchAdd } from './CardSearchAdd'
import { CubeSyncDialog } from './CubeSyncDialog'
import { useHoverPreview } from './HoverPreview'
import { ListCompareView } from './ListCompareView'
import { StatsView } from './StatsView'
import { TagEditor } from './TagEditor'

type OwnFilter = 'all' | 'owned' | 'partial' | 'not_owned' | 'overused'
type Tab = 'cards' | 'stats' | 'compare'

const TAB_LABEL: Record<Tab, string> = { cards: 'Cards', stats: 'Stats', compare: 'Compare' }

const isOverused = (i: ListItem) => i.owned > 0 && i.quantity + i.used_elsewhere > i.owned

/** "owned/copies" (just copies when all owned) shown in each group header. */
function GroupCount({ copies, owned, missingValue }: { copies: number; owned: number; missingValue: number }) {
  return (
    <span className="shrink-0 font-mono text-xs font-normal text-dim" title={`${owned} of ${copies} copies owned${missingValue > 0 ? `, ${fmtEur(missingValue)} to complete` : ''}`}>
      {owned < copies ? `${owned}/${copies}` : copies}
    </span>
  )
}

const MissingValue = ({ value }: { value: number }) =>
  value > 0 ? <span className="font-mono text-[11px] font-normal text-soft">{fmtEur(value)} to complete</span> : null

/** Shown while the hover controls of a row/tile are visible: on hover or while the tag popover is open. */
const SHOW_CONTROLS = 'group-hover:flex group-has-[[data-state=open]]:flex'
const HIDE_ON_CONTROLS = 'group-hover:hidden group-has-[[data-state=open]]:hidden'

function OwnershipPill({ item }: { item: ListItem }) {
  if (item.ownership === 'not_owned') return <span className="pill bg-[#2A2D35] text-muted">NOT OWNED</span>
  if (item.ownership === 'partial')
    return (
      <span className="pill bg-[#2A2D35] text-soft" title={`You own ${item.owned} of ${item.quantity} copies`}>
        {item.owned}/{item.quantity}
      </span>
    )
  if (isOverused(item))
    return (
      <span className="pill bg-warn-line text-warn-fg" title={`${item.quantity + item.used_elsewhere} used across lists, ${item.owned} owned`}>
        {item.quantity + item.used_elsewhere}/{item.owned}
      </span>
    )
  return null
}

interface ItemProps {
  item: ListItem
  listId: number
  knownTags: string[]
  onQty: (item: ListItem, q: number) => void
  onOpen: (item: ListItem) => void
}

function ItemRow({ item, listId, knownTags, onQty, onOpen }: ItemProps) {
  const hover = useHoverPreview(item.card, item.ownership === 'not_owned')
  const notOwned = item.ownership === 'not_owned'
  return (
    <div className={clsx('group flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-panel-2', isOverused(item) && 'bg-warn-bg', notOwned && 'opacity-50 hover:opacity-80')}>
      <button
        type="button"
        className={clsx('min-w-0 flex-1 truncate text-left', notOwned && 'italic text-muted')}
        title={item.tags.length ? `Tags: ${item.tags.join(', ')}` : undefined}
        onClick={() => onOpen(item)}
        {...hover}
      >
        {item.quantity > 1 && <span className="mr-1 font-mono text-dim">{item.quantity}×</span>}
        {item.card.name}
      </button>
      <span className={HIDE_ON_CONTROLS}>
        <OwnershipPill item={item} />
      </span>
      <span className={clsx('font-mono text-[11px] text-dim', HIDE_ON_CONTROLS)}>{isLand(item.card) ? '' : item.card.cmc}</span>
      <span className={clsx('hidden items-center gap-0.5', SHOW_CONTROLS)}>
        <TagEditor listId={listId} item={item} known={knownTags} className="h-6 w-6" />
        <button type="button" aria-label={`Remove a copy of ${item.card.name}`} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-chip hover:text-fg" onClick={() => onQty(item, item.quantity - 1)}>
          {item.quantity > 1 ? <Minus size={13} /> : <Trash2 size={13} />}
        </button>
        <button type="button" aria-label={`Add a copy of ${item.card.name}`} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-chip hover:text-fg" onClick={() => onQty(item, item.quantity + 1)}>
          <Plus size={13} />
        </button>
      </span>
    </div>
  )
}

function ItemTile({ item, listId, knownTags, onQty, onOpen }: ItemProps) {
  const notOwned = item.ownership === 'not_owned'
  const hover = useHoverPreview(item.card, notOwned)
  return (
    <div className="group flex flex-col gap-1.5">
      <div className="relative cursor-pointer" onClick={() => onOpen(item)} {...hover}>
        <CardImage card={item.card} dimmed={notOwned} />
        {notOwned && (
          <span className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 rounded-md border border-line-3 bg-bg/90 px-2 py-1 text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap">
            NOT OWNED
          </span>
        )}
        {item.quantity > 1 && <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-px font-mono text-[11px] font-bold text-accent-ink">×{item.quantity}</span>}
        <div className="absolute inset-x-2 bottom-2 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-has-[[data-state=open]]:opacity-100">
          <TagEditor listId={listId} item={item} known={knownTags} className="h-8 w-8 rounded-lg bg-bg/90" />
          <button type="button" aria-label="Remove a copy" className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg/90 hover:bg-chip" onClick={(e) => { e.stopPropagation(); onQty(item, item.quantity - 1) }}>
            {item.quantity > 1 ? <Minus size={14} /> : <Trash2 size={14} />}
          </button>
          <button type="button" aria-label="Add a copy" className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg/90 hover:bg-chip" onClick={(e) => { e.stopPropagation(); onQty(item, item.quantity + 1) }}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5 text-[11px]">
        <span className="truncate text-dim">{item.card.name}</span>
        <OwnershipPill item={item} />
      </div>
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-0.5">
          {item.tags.map((t) => (
            <span key={t} className="rounded-full bg-chip px-1.5 py-px text-[10px] text-soft">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ListDetailView({ listId }: { listId: number }) {
  const navigate = useNavigate()
  const version = useData((s) => s.listsVersion)
  const listsChanged = useData((s) => s.listsChanged)
  const rate = useUsdRate()
  const [list, setList] = useState<ListDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('cards')
  const [own, setOwn] = useState<OwnFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('color')
  const [view, setView] = useState<'columns' | 'grid'>('columns')
  const [includeNotOwned, setIncludeNotOwned] = useState(true)
  const [editing, setEditing] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const reload = useCallback(() => {
    api.list(listId).then(
      (l) => {
        setList(l)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [listId])
  useEffect(reload, [reload, version])

  const items = useMemo(() => list?.items ?? [], [list])
  const counts = useMemo(
    () => ({
      all: items.length,
      owned: items.filter((i) => i.ownership === 'owned').length,
      partial: items.filter((i) => i.ownership === 'partial').length,
      not_owned: items.filter((i) => i.ownership === 'not_owned').length,
      overused: items.filter(isOverused).length,
    }),
    [items],
  )
  const tags = useMemo(() => listTags(items), [items])
  const activeTag = tagFilter ? (tags.find((t) => t.toLowerCase() === tagFilter.toLowerCase()) ?? null) : null
  const shown = useMemo(() => {
    const byOwn = own === 'all' ? items : own === 'overused' ? items.filter(isOverused) : items.filter((i) => i.ownership === own)
    return activeTag ? byOwn.filter((i) => hasTag(i, activeTag)) : byOwn
  }, [items, own, activeTag])
  const groups = useMemo(() => groupItems(shown, groupBy, (i) => marketPrice(i.card, 'normal', rate) ?? 0), [shown, groupBy, rate])
  const copies = items.reduce((n, i) => n + i.quantity, 0)
  const value = items.reduce((n, i) => n + (marketPrice(i.card, 'normal', rate) ?? 0) * i.quantity, 0)

  const stats = useMemo(
    () =>
      computeStats(
        items
          .map((i) => ({
            card: i.card,
            quantity: includeNotOwned ? i.quantity : Math.min(i.quantity, i.owned),
            unitMarket: marketPrice(i.card, 'normal', rate),
            purchaseValue: null,
            foil: false,
          }))
          .filter((i) => i.quantity > 0),
      ),
    [items, includeNotOwned, rate],
  )

  const setQty = async (item: ListItem, q: number) => {
    try {
      if (q <= 0) await api.deleteItem(listId, item.id)
      else await api.updateItem(listId, item.id, { quantity: q })
      await listsChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (error) return <div className="panel p-6 text-sm text-bad">Could not load the list: {error}</div>
  if (!list) return <div className="h-40 animate-pulse rounded-xl bg-panel" />

  const detailCard = detailId ? (items.find((i) => i.scryfall_id === detailId)?.card ?? null) : null
  const overused = items.filter(isOverused)
  // A linked cube compares the collection with what CubeCobra marks as owned; otherwise with the sharer's copies.
  const compareItems = list.cubecobra_id ? items.map((i) => ({ ...i, their_owned: i.cube_owned })) : items
  const comparable = hasComparison(compareItems)
  const tabs: Tab[] = comparable ? ['cards', 'stats', 'compare'] : ['cards', 'stats']

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const name = new FormData(e.currentTarget).get('name')?.toString().trim()
                if (name) await api.updateList(listId, { name })
                setEditing(false)
                await listsChanged()
              }}
            >
              <input name="name" autoFocus defaultValue={list.name} aria-label="List name" className="field text-xl font-bold" />
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2.5">
              <h1 className="m-0 truncate text-[28px] font-bold tracking-[-0.02em]">{list.name}</h1>
              <button
                type="button"
                className="rounded-md bg-[#3A2E17] px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-[#F0C47A] hover:bg-warn-line"
                title="Change type"
                onClick={async () => {
                  await api.updateList(listId, { kind: list.kind === 'cube' ? 'generic' : 'cube' })
                  await listsChanged()
                }}
              >
                {list.kind === 'cube' ? 'CUBE' : 'LIST'}
              </button>
              <button type="button" className="btn btn-ghost btn-icon min-h-9 w-9" aria-label="Rename" onClick={() => setEditing(true)}>
                <Pencil size={15} />
              </button>
            </div>
          )}
          {list.cubecobra_id && (
            <span className="flex items-center gap-1.5 text-[13px] text-soft">
              <a className="flex items-center gap-1 text-accent hover:text-accent-hi" href={`https://cubecobra.com/cube/list/${list.cubecobra_id}`} target="_blank" rel="noreferrer">
                CubeCobra · {list.cubecobra_id} <ExternalLink size={12} />
              </a>
              {list.synced_at && <span className="text-dim">synced {new Date(list.synced_at).toLocaleString()}</span>}
            </span>
          )}
          {list.shared_by && (
            <span className="flex items-center gap-1.5 text-[13px] text-soft">
              <Users size={14} className="text-accent" /> Shared by <strong className="font-semibold">{list.shared_by}</strong>
            </span>
          )}
          <span className="text-sm text-muted">
            <span className="font-mono text-fg">{fmtNum(copies)}</span> {list.kind === 'cube' ? 'cards' : 'copies'} · {fmtNum(items.length)} unique
            {counts.not_owned > 0 && <span className="text-soft"> · {counts.not_owned} not owned</span>} · <span className="font-mono">{fmtEur(value)}</span> market
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {list.cubecobra_id && (
            <button type="button" className="btn" onClick={() => setSyncing(true)} title="Update the list from its CubeCobra cube">
              <RefreshCw size={15} /> Sync
            </button>
          )}
          <a className="btn" href={api.exportUrl(listId, 'viewer')} download title="ManaBox Viewer list with your ownership: another user can import it and compare">
            <Share2 size={15} /> Share
          </a>
          <Popover.Root>
            <Popover.Trigger className="btn">
              <Download size={15} /> Export <ChevronDown size={14} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} className="z-50 flex w-64 flex-col rounded-xl border border-[#3A3F4B] bg-raised p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.55)]">
                <a className="flex flex-col rounded-lg px-3 py-2 hover:bg-panel-2" href={api.exportUrl(listId, 'txt')} download>
                  <span className="text-sm">List .txt</span>
                  <span className="text-xs text-dim">“1 Name (SET) 123”, for any deck tool</span>
                </a>
                <a
                  className={clsx('flex flex-col rounded-lg px-3 py-2 hover:bg-panel-2', counts.not_owned + counts.partial === 0 && 'pointer-events-none opacity-45')}
                  href={api.exportUrl(listId, 'missing')}
                  download
                  aria-disabled={counts.not_owned + counts.partial === 0}
                >
                  <span className="text-sm">Missing cards .txt</span>
                  <span className="text-xs text-dim">only the copies you don't own</span>
                </a>
                <div className="my-1 border-t border-line" />
                {list.cubecobra_id ? (
                  <button
                    type="button"
                    className="flex flex-col rounded-lg px-3 py-2 text-left hover:bg-panel-2"
                    onClick={async () => {
                      if (!window.confirm('Unlink the list from its CubeCobra cube? The cards stay.')) return
                      try {
                        await api.updateList(listId, { cubecobra_id: '' })
                        await listsChanged()
                      } catch (e) {
                        toast.error((e as Error).message)
                      }
                    }}
                  >
                    <span className="text-sm">Unlink from CubeCobra</span>
                    <span className="text-xs text-dim">keep the cards, stop syncing</span>
                  </button>
                ) : (
                  <button type="button" className="flex flex-col rounded-lg px-3 py-2 text-left hover:bg-panel-2" onClick={() => setSyncing(true)}>
                    <span className="flex items-center gap-1.5 text-sm">
                      <Link2 size={14} /> Link to CubeCobra cube…
                    </span>
                    <span className="text-xs text-dim">sync the cards and tags from a cube URL</span>
                  </button>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <a className="btn btn-primary" href={api.exportUrl(listId, 'cubecobra_csv')} download>
            <Download size={15} /> CubeCobra CSV
          </a>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Delete list"
            onClick={async () => {
              if (!window.confirm(`Delete the list "${list.name}"? This cannot be undone.`)) return
              await api.deleteList(listId)
              await listsChanged()
              navigate('/lists', { replace: true })
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {overused.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
          <AlertTriangle size={18} className="shrink-0 text-[#F0B44A]" />
          <span>
            <strong>{overused.length} card{overused.length === 1 ? '' : 's'}</strong> {overused.length === 1 ? 'is' : 'are'} used in more lists than the copies you own:{' '}
            {overused.slice(0, 4).map((i, n) => (
              <span key={i.id}>
                {n > 0 && ', '}
                <strong>{i.card.name}</strong> ({i.quantity + i.used_elsewhere} used / {i.owned} owned)
              </span>
            ))}
            {overused.length > 4 && ` and ${overused.length - 4} more`}.
          </span>
          <button type="button" className="ml-auto text-[13px] text-accent hover:text-accent-hi" onClick={() => { setTab('cards'); setOwn('overused') }}>
            Show only these
          </button>
        </div>
      )}

      <div role="tablist" className="flex items-center gap-6 border-b border-line">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={clsx('-mb-px min-h-11 border-b-2 px-1 text-sm font-medium', tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="flex-1" />
        {tab === 'cards' && (
          <div className="flex items-center gap-2 pb-1.5">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Group by
              <select className="field min-h-9" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
            <div role="group" aria-label="View" className="flex rounded-[9px] border border-line bg-[#15171D] p-[3px]">
              <button type="button" aria-label="Columns" aria-pressed={view === 'columns'} className={clsx('seg px-2.5', view === 'columns' && 'seg-on')} onClick={() => setView('columns')}>
                <Rows3 size={16} />
              </button>
              <button type="button" aria-label="Images" aria-pressed={view === 'grid'} className={clsx('seg px-2.5', view === 'grid' && 'seg-on')} onClick={() => setView('grid')}>
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {tab === 'cards' ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <CardSearchAdd listId={listId} />
            <div role="group" aria-label="Filter by ownership" className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', `All ${counts.all}`],
                  ['owned', `Owned ${counts.owned}`],
                  ['partial', `Partial ${counts.partial}`],
                  ['not_owned', `Not owned ${counts.not_owned}`],
                  ...(counts.overused ? [['overused', `Not enough copies ${counts.overused}`]] : []),
                ] as [OwnFilter, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={own === k} className={clsx('min-h-[34px] rounded-full border px-3 text-[12.5px] font-medium', own === k ? 'border-[#3A3F4B] bg-chip text-fg' : 'border-line-2 text-muted hover:text-fg')} onClick={() => setOwn(k)}>
                  {label}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <Tag size={14} />
                <select className="field min-h-[34px]" aria-label="Filter by tag" value={activeTag ?? ''} onChange={(e) => setTagFilter(e.target.value || null)}>
                  <option value="">All tags</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {items.length > 0 && (
            <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-3 text-[13px] text-muted">
              {stats.colors.filter((c) => c.value > 0).map((c) => (
                <span key={c.key} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET_COLOR[c.key] }} />
                  {BUCKET_LABEL[c.key]} <span className="font-mono text-fg">{c.value}</span>
                </span>
              ))}
              <span className="flex-1" />
              <span className="flex h-[26px] items-end gap-[3px]" aria-label="Mana curve">
                {stats.curve.map((b) => {
                  const max = Math.max(1, ...stats.curve.map((x) => x.value))
                  return <span key={b.key} title={`MV ${b.label}: ${b.value}`} className="w-[9px] rounded-[2px] bg-accent" style={{ height: Math.max(2, (b.value / max) * 26) }} />
                })}
              </span>
              {stats.avgMv != null && <span className="font-mono text-fg">avg MV {stats.avgMv.toFixed(2)}</span>}
            </div>
          )}

          {items.length === 0 ? (
            <div className="panel px-6 py-14 text-center text-sm text-muted">
              Empty list. Add cards with the field above, or from the Collection with “Add to list” or multi-selection.
            </div>
          ) : shown.length === 0 ? (
            <div className="panel px-6 py-10 text-center text-sm text-muted">No cards match this filter.</div>
          ) : view === 'columns' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-3.5">
              {groups.map((g) => (
                <section key={g.key} className="overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="border-t-[3px] bg-[#171920] px-3 py-2.5" style={{ borderTopColor: g.color }}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="m-0 truncate text-[13px] font-semibold">{g.title}</h2>
                      <GroupCount copies={g.copies} owned={g.owned} missingValue={g.missingValue} />
                    </div>
                    <MissingValue value={g.missingValue} />
                  </div>
                  <div className="p-1.5">
                    {g.items.map((i) => (
                      <ItemRow key={i.id} item={i} listId={listId} knownTags={tags} onQty={setQty} onOpen={(it) => setDetailId(it.scryfall_id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <section key={g.key} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                      {g.title} <GroupCount copies={g.copies} owned={g.owned} missingValue={g.missingValue} />
                    </h2>
                    <MissingValue value={g.missingValue} />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                    {g.items.map((i) => (
                      <ItemTile key={i.id} item={i} listId={listId} knownTags={tags} onQty={setQty} onOpen={(it) => setDetailId(it.scryfall_id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : tab === 'compare' && comparable ? (
        <ListCompareView
          items={compareItems}
          sharedBy={list.cubecobra_id ? 'CubeCobra' : list.shared_by}
          note={list.cubecobra_id ? 'owned, proxied or borrowed, as of the last sync' : 'ownership as of their export'}
          onOpen={(it) => setDetailId(it.scryfall_id)}
        />
      ) : (
        <>
          <label className="flex items-center gap-2 self-start text-[13px] text-muted">
            <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={includeNotOwned} onChange={(e) => setIncludeNotOwned(e.target.checked)} />
            Include copies you don't own
          </label>
          <StatsView stats={stats} showPurchase={false} topTitle="Most valuable cards in the list" />
        </>
      )}

      <CardDetailDrawer card={detailCard} onClose={() => setDetailId(null)} />
      {syncing && <CubeSyncDialog listId={listId} cubeId={list.cubecobra_id} onClose={() => setSyncing(false)} />}
    </>
  )
}
