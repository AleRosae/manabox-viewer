import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, ExternalLink, LayoutGrid, Pencil, Rows3, Tag, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { BUCKET_COLOR, BUCKET_LABEL, fmtEur, fmtNum, marketPrice } from '../../lib/cards'
import { hasComparison } from '../../lib/compare'
import { FORMAT_ORDER, FORMATS, validateDeck } from '../../lib/legality'
import { BOARD_LABEL, GROUP_LABEL, type GroupBy, groupDeckItems, groupItems, hasTag, isOverused, listTags, THEN_LABEL, type ThenBy, thenByAfter, thenByOptions } from '../../lib/listGroups'
import { deckUrl } from '../../lib/moxfield'
import { listPath } from '../../lib/paths'
import { computeStats } from '../../lib/stats'
import type { Board, DeckFormat, ListDetail, ListItem, ListKind } from '../../lib/types'
import { setLastListId, useData, useUsdRate } from '../../store/data'
import { getGrouping, type Grouping, setGrouping, usePendingMoxfield } from '../../store/ui'
import { CardDetailDrawer } from '../CardDetailDrawer'
import { CardSearchAdd } from '../CardSearchAdd'
import { ListCompareView } from '../ListCompareView'
import { StatsView } from '../StatsView'
import { GroupedItems } from './ItemViews'
import { CubeActions, DeckActions } from './ListActions'
import { SyncDialog } from './SyncDialog'
import { TokensView } from './TokensView'

type OwnFilter = 'all' | 'owned' | 'partial' | 'not_owned' | 'overused'
type Tab = 'cards' | 'stats' | 'tokens' | 'compare'

const TAB_LABEL: Record<Tab, string> = { cards: 'Cards', stats: 'Stats', tokens: 'Tokens', compare: 'Compare' }

/** Where the list syncs from, with the last sync. */
function RemoteLine({ list }: { list: ListDetail }) {
  if (!list.remote_source || !list.remote_id) return null
  const [service, url] =
    list.remote_source === 'cubecobra' ? ['CubeCobra', `https://cubecobra.com/cube/list/${list.remote_id}`] : ['Moxfield', deckUrl(list.remote_id)]
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-soft">
      <a className="flex items-center gap-1 text-accent hover:text-accent-hi" href={url} target="_blank" rel="noreferrer">
        {service} · {list.remote_id} <ExternalLink size={12} />
      </a>
      {list.synced_at && <span className="text-dim">synced {new Date(list.synced_at).toLocaleString()}</span>}
    </span>
  )
}

function FormatSelect({ list }: { list: ListDetail }) {
  return (
    <select
      className="field min-h-8 py-0 text-[12px] font-semibold"
      aria-label="Format"
      value={list.format ?? 'none'}
      onChange={async (e) => {
        try {
          await api.updateList(list.id, { format: e.target.value as DeckFormat })
          await useData.getState().listsChanged()
        } catch (err) {
          toast.error((err as Error).message)
        }
      }}
    >
      {FORMAT_ORDER.map((f) => (
        <option key={f} value={f}>
          {FORMATS[f].label}
        </option>
      ))}
    </select>
  )
}

/** Cubes and decks: same view, decks add boards, a format and its legality check. */
export function ListDetailView({ listId, kind }: { listId: number; kind: ListKind }) {
  const navigate = useNavigate()
  const version = useData((s) => s.listsVersion)
  const listsChanged = useData((s) => s.listsChanged)
  const rate = useUsdRate()
  const [list, setList] = useState<ListDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('cards')
  const [own, setOwn] = useState<OwnFilter>('all')
  const [grouping, setGroupingState] = useState<Grouping>(() => getGrouping(kind))
  const { by: groupBy, then: thenBy } = grouping
  const changeGrouping = (next: Grouping) => {
    setGroupingState(next)
    setGrouping(kind, next)
  }
  const [view, setView] = useState<'columns' | 'grid'>('columns')
  const [addBoard, setAddBoard] = useState<Board>('main')
  const [includeNotOwned, setIncludeNotOwned] = useState(true)
  const [editing, setEditing] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const pending = usePendingMoxfield((s) => s.deck)

  const reload = useCallback(() => {
    api.list(listId).then(
      (l) => {
        setList(l)
        setError(null)
        setLastListId(l.id, l.kind)
      },
      (e: Error) => setError(e.message),
    )
  }, [listId])
  useEffect(reload, [reload, version])

  const items = useMemo(() => list?.items ?? [], [list])
  // The maybeboard is shown but doesn't count: not in the totals, stats or overuse.
  const played = useMemo(() => items.filter((i) => i.board !== 'maybe'), [items])
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
  const price = useCallback((i: ListItem) => marketPrice(i.card, 'normal', rate) ?? 0, [rate])
  const groups = useMemo(
    () => (list?.kind === 'deck' ? groupDeckItems(shown, groupBy, thenBy, price) : groupItems(shown, groupBy, thenBy, price)),
    [list?.kind, shown, groupBy, thenBy, price],
  )
  const issues = useMemo(() => (list?.kind === 'deck' ? validateDeck(items, list.format ?? 'none') : []), [list, items])
  const issueByCard = useMemo(() => {
    const map = new Map<string, string>()
    for (const issue of issues) for (const oid of issue.oracleIds) map.set(oid, map.has(oid) ? `${map.get(oid)}\n${issue.message}` : issue.message)
    return map
  }, [issues])
  const copies = played.reduce((n, i) => n + i.quantity, 0)
  const value = played.reduce((n, i) => n + price(i) * i.quantity, 0)
  const missing = played.reduce((n, i) => n + Math.max(0, i.quantity - i.owned), 0)

  const stats = useMemo(
    () =>
      computeStats(
        played
          .map((i) => ({
            card: i.card,
            quantity: includeNotOwned ? i.quantity : Math.min(i.quantity, i.owned),
            unitMarket: marketPrice(i.card, 'normal', rate),
            purchaseValue: null,
            foil: false,
          }))
          .filter((i) => i.quantity > 0),
      ),
    [played, includeNotOwned, rate],
  )

  // A deck the bookmarklet sent for this list: its sync opens right away.
  const payload = pending && list?.kind === 'deck' && list.remote_source === 'moxfield' && pending.id === list.remote_id ? pending : undefined
  const closeSync = () => {
    setSyncing(false)
    if (payload) usePendingMoxfield.getState().set(null)
  }

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
  if (list.kind !== kind) return <Navigate to={listPath(list)} replace />

  const deck = list.kind === 'deck'
  const detailCard = detailId ? (items.find((i) => i.scryfall_id === detailId)?.card ?? null) : null
  const overused = items.filter(isOverused)
  // A cube linked to CubeCobra compares the collection with what CubeCobra marks as owned; otherwise with the sharer's copies.
  const fromCubeCobra = list.remote_source === 'cubecobra'
  const compareItems = fromCubeCobra ? items.map((i) => ({ ...i, their_owned: i.cube_owned })) : items
  const comparable = hasComparison(compareItems)
  const tabs: Tab[] = ['cards', 'stats', 'tokens', ...(comparable ? (['compare'] as Tab[]) : [])]
  const format = list.format ?? 'none'

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
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0 truncate text-[28px] font-bold tracking-[-0.02em]">{list.name}</h1>
              <span className="rounded-md bg-[#3A2E17] px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-[#F0C47A]">{deck ? 'DECK' : 'CUBE'}</span>
              {deck && <FormatSelect list={list} />}
              <button type="button" className="btn btn-ghost btn-icon min-h-9 w-9" aria-label="Rename" onClick={() => setEditing(true)}>
                <Pencil size={15} />
              </button>
            </div>
          )}
          <RemoteLine list={list} />
          {list.shared_by && (
            <span className="flex items-center gap-1.5 text-[13px] text-soft">
              <Users size={14} className="text-accent" /> Shared by <strong className="font-semibold">{list.shared_by}</strong>
            </span>
          )}
          <span className="text-sm text-muted">
            <span className="font-mono text-fg">{fmtNum(copies)}</span> cards · {fmtNum(new Set(played.map((i) => i.oracle_id)).size)} unique
            {counts.not_owned > 0 && <span className="text-soft"> · {counts.not_owned} not owned</span>} · <span className="font-mono">{fmtEur(value)}</span> market
            {deck && format !== 'none' && issues.length === 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-ok">
                <CheckCircle2 size={14} /> legal in {FORMATS[format].label}
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {deck ? (
            <DeckActions list={list} missing={missing} onSync={() => setSyncing(true)} />
          ) : (
            <CubeActions list={list} missing={missing} onSync={() => setSyncing(true)} />
          )}
          <button
            type="button"
            className="btn btn-icon"
            aria-label={`Delete ${deck ? 'deck' : 'cube'}`}
            onClick={async () => {
              if (!window.confirm(`Delete "${list.name}"? This cannot be undone.`)) return
              await api.deleteList(listId)
              await listsChanged()
              navigate(deck ? '/decks' : '/cubes', { replace: true })
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {issues.length > 0 && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-xl border border-bad/40 bg-panel px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-semibold text-bad">
            <AlertTriangle size={16} /> Not legal in {FORMATS[format].label}
          </span>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-6 text-soft">
            {issues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

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
              <select
                className="field min-h-9"
                value={groupBy}
                onChange={(e) => {
                  const by = e.target.value as GroupBy
                  changeGrouping({ by, then: thenByAfter(groupBy, thenBy, by) })
                }}
              >
                {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Then by
              <select className="field min-h-9" value={thenBy} onChange={(e) => changeGrouping({ by: groupBy, then: e.target.value as ThenBy })}>
                {thenByOptions(groupBy).map((g) => (
                  <option key={g} value={g}>
                    {THEN_LABEL[g]}
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
            <CardSearchAdd listId={listId} board={deck ? addBoard : undefined} />
            {deck && (
              <select className="field min-h-11" aria-label="Board to add cards to" value={addBoard} onChange={(e) => setAddBoard(e.target.value as Board)}>
                {(Object.keys(BOARD_LABEL) as Board[]).map((b) => (
                  <option key={b} value={b}>
                    to {BOARD_LABEL[b]}
                  </option>
                ))}
              </select>
            )}
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

          {played.length > 0 && (
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
              Empty {deck ? 'deck' : 'cube'}. Add cards with the field above, or from the Collection with “Add to list” or multi-selection.
            </div>
          ) : shown.length === 0 ? (
            <div className="panel px-6 py-10 text-center text-sm text-muted">No cards match this filter.</div>
          ) : (
            <GroupedItems
              groups={groups}
              view={view}
              actions={{ listId, knownTags: tags, boards: deck, issues: issueByCard, onQty: setQty, onOpen: (it) => setDetailId(it.scryfall_id) }}
            />
          )}
        </>
      ) : tab === 'tokens' ? (
        <TokensView listId={listId} />
      ) : tab === 'compare' && comparable ? (
        <ListCompareView
          items={compareItems}
          listName={list.name}
          sharedBy={fromCubeCobra ? 'CubeCobra' : list.shared_by}
          note={fromCubeCobra ? 'owned, proxied or borrowed, as of the last sync' : 'ownership as of their export'}
          onOpen={(it) => setDetailId(it.scryfall_id)}
        />
      ) : (
        <>
          <label className="flex items-center gap-2 self-start text-[13px] text-muted">
            <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={includeNotOwned} onChange={(e) => setIncludeNotOwned(e.target.checked)} />
            Include copies you don't own
          </label>
          <StatsView stats={stats} showPurchase={false} topTitle={`Most valuable cards in the ${deck ? 'deck' : 'cube'}`} />
        </>
      )}

      <CardDetailDrawer card={detailCard} onClose={() => setDetailId(null)} />
      {(syncing || payload) && <SyncDialog list={list} payload={payload} onClose={closeSync} />}
    </>
  )
}
