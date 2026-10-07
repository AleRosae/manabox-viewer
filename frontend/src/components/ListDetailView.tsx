import clsx from 'clsx'
import { AlertTriangle, Download, LayoutGrid, Minus, Pencil, Plus, Rows3, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { BUCKET_COLOR, BUCKET_LABEL, BUCKET_ORDER, colorBucket, fmtEur, fmtNum, isLand, marketPrice, primaryType } from '../lib/cards'
import { computeStats } from '../lib/stats'
import type { ListDetail, ListItem } from '../lib/types'
import { useData, useUsdRate } from '../store/data'
import { CardDetailDrawer } from './CardDetailDrawer'
import { CardImage } from './CardImage'
import { CardSearchAdd } from './CardSearchAdd'
import { useHoverPreview } from './HoverPreview'
import { StatsView } from './StatsView'

type OwnFilter = 'all' | 'owned' | 'partial' | 'not_owned' | 'overused'
type GroupBy = 'color' | 'type' | 'mv'

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other']
const TYPE_LABEL: Record<string, string> = {
  Creature: 'Creature', Planeswalker: 'Planeswalker', Instant: 'Instant', Sorcery: 'Sorcery', Artifact: 'Artifact',
  Enchantment: 'Enchantment', Battle: 'Battle', Land: 'Terre', Other: 'Altro',
}

const isOverused = (i: ListItem) => i.owned > 0 && i.quantity + i.used_elsewhere > i.owned

function groupItems(items: ListItem[], by: GroupBy) {
  const groups = new Map<string, ListItem[]>()
  const keyOf = (i: ListItem) =>
    by === 'color' ? colorBucket(i.card) : by === 'type' ? primaryType(i.card) : isLand(i.card) ? 'L' : String(Math.min(7, Math.floor(i.card.cmc)))
  for (const i of items) {
    const k = keyOf(i)
    groups.set(k, [...(groups.get(k) ?? []), i])
  }
  const order = by === 'color' ? BUCKET_ORDER : by === 'type' ? TYPE_ORDER : ['0', '1', '2', '3', '4', '5', '6', '7', 'L']
  return order
    .filter((k) => groups.has(k))
    .map((k) => ({
      key: k,
      title: by === 'color' ? BUCKET_LABEL[k] : by === 'type' ? TYPE_LABEL[k] : k === 'L' ? 'Terre' : k === '7' ? 'MV 7+' : `MV ${k}`,
      color: by === 'color' ? BUCKET_COLOR[k] : '#3A3F4B',
      items: groups.get(k)!.sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)),
    }))
}

function OwnershipPill({ item }: { item: ListItem }) {
  if (item.ownership === 'not_owned') return <span className="pill bg-[#2A2D35] text-muted">NON POSS.</span>
  if (item.ownership === 'partial')
    return (
      <span className="pill bg-[#2A2D35] text-soft" title={`Possiedi ${item.owned} copie su ${item.quantity}`}>
        {item.owned}/{item.quantity}
      </span>
    )
  if (isOverused(item))
    return (
      <span className="pill bg-warn-line text-warn-fg" title={`${item.quantity + item.used_elsewhere} usate in tutte le liste, ${item.owned} possedute`}>
        {item.quantity + item.used_elsewhere}/{item.owned}
      </span>
    )
  return null
}

interface ItemProps {
  item: ListItem
  onQty: (item: ListItem, q: number) => void
  onOpen: (item: ListItem) => void
}

function ItemRow({ item, onQty, onOpen }: ItemProps) {
  const hover = useHoverPreview(item.card, item.ownership === 'not_owned')
  const notOwned = item.ownership === 'not_owned'
  return (
    <div className={clsx('group flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-panel-2', isOverused(item) && 'bg-warn-bg', notOwned && 'opacity-50 hover:opacity-80')}>
      <button type="button" className={clsx('min-w-0 flex-1 truncate text-left', notOwned && 'italic text-muted')} onClick={() => onOpen(item)} {...hover}>
        {item.quantity > 1 && <span className="mr-1 font-mono text-dim">{item.quantity}×</span>}
        {item.card.name}
      </button>
      <span className="group-hover:hidden">
        <OwnershipPill item={item} />
      </span>
      <span className="font-mono text-[11px] text-dim group-hover:hidden">{isLand(item.card) ? '' : item.card.cmc}</span>
      <span className="hidden items-center gap-0.5 group-hover:flex">
        <button type="button" aria-label={`Togli una copia di ${item.card.name}`} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-chip hover:text-fg" onClick={() => onQty(item, item.quantity - 1)}>
          {item.quantity > 1 ? <Minus size={13} /> : <Trash2 size={13} />}
        </button>
        <button type="button" aria-label={`Aggiungi una copia di ${item.card.name}`} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-chip hover:text-fg" onClick={() => onQty(item, item.quantity + 1)}>
          <Plus size={13} />
        </button>
      </span>
    </div>
  )
}

function ItemTile({ item, onQty, onOpen }: ItemProps) {
  const notOwned = item.ownership === 'not_owned'
  const hover = useHoverPreview(item.card, notOwned)
  return (
    <div className="group flex flex-col gap-1.5">
      <div className="relative cursor-pointer" onClick={() => onOpen(item)} {...hover}>
        <CardImage card={item.card} dimmed={notOwned} />
        {notOwned && (
          <span className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 rounded-md border border-line-3 bg-bg/90 px-2 py-1 text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap">
            NON POSSEDUTA
          </span>
        )}
        {item.quantity > 1 && <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-px font-mono text-[11px] font-bold text-accent-ink">×{item.quantity}</span>}
        <div className="absolute inset-x-2 bottom-2 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" aria-label="Togli una copia" className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg/90 hover:bg-chip" onClick={(e) => { e.stopPropagation(); onQty(item, item.quantity - 1) }}>
            {item.quantity > 1 ? <Minus size={14} /> : <Trash2 size={14} />}
          </button>
          <button type="button" aria-label="Aggiungi una copia" className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg/90 hover:bg-chip" onClick={(e) => { e.stopPropagation(); onQty(item, item.quantity + 1) }}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5 text-[11px]">
        <span className="truncate text-dim">{item.card.name}</span>
        <OwnershipPill item={item} />
      </div>
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
  const [tab, setTab] = useState<'cards' | 'stats'>('cards')
  const [own, setOwn] = useState<OwnFilter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('color')
  const [view, setView] = useState<'columns' | 'grid'>('columns')
  const [includeNotOwned, setIncludeNotOwned] = useState(true)
  const [editing, setEditing] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

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
  const shown = useMemo(() => (own === 'all' ? items : own === 'overused' ? items.filter(isOverused) : items.filter((i) => i.ownership === own)), [items, own])
  const groups = useMemo(() => groupItems(shown, groupBy), [shown, groupBy])
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

  if (error) return <div className="panel p-6 text-sm text-bad">Impossibile caricare la lista: {error}</div>
  if (!list) return <div className="h-40 animate-pulse rounded-xl bg-panel" />

  const detailCard = detailId ? (items.find((i) => i.scryfall_id === detailId)?.card ?? null) : null
  const overused = items.filter(isOverused)

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
              <input name="name" autoFocus defaultValue={list.name} aria-label="Nome della lista" className="field text-xl font-bold" />
              <button type="submit" className="btn btn-primary">
                Salva
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2.5">
              <h1 className="m-0 truncate text-[28px] font-bold tracking-[-0.02em]">{list.name}</h1>
              <button
                type="button"
                className="rounded-md bg-[#3A2E17] px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-[#F0C47A] hover:bg-warn-line"
                title="Cambia tipo"
                onClick={async () => {
                  await api.updateList(listId, { kind: list.kind === 'cube' ? 'generic' : 'cube' })
                  await listsChanged()
                }}
              >
                {list.kind === 'cube' ? 'CUBO' : 'LISTA'}
              </button>
              <button type="button" className="btn btn-ghost btn-icon min-h-9 w-9" aria-label="Rinomina" onClick={() => setEditing(true)}>
                <Pencil size={15} />
              </button>
            </div>
          )}
          <span className="text-sm text-muted">
            <span className="font-mono text-fg">{fmtNum(copies)}</span> {list.kind === 'cube' ? 'carte' : 'copie'} · {fmtNum(items.length)} uniche
            {counts.not_owned > 0 && <span className="text-soft"> · {counts.not_owned} non possedute</span>} · <span className="font-mono">{fmtEur(value)}</span> mercato
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={api.exportUrl(listId, 'txt')} download>
            <Download size={15} /> Lista .txt
          </a>
          <a className="btn btn-primary" href={api.exportUrl(listId, 'cubecobra_csv')} download>
            <Download size={15} /> Export CubeCobra CSV
          </a>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Elimina lista"
            onClick={async () => {
              if (!window.confirm(`Eliminare la lista "${list.name}"? L'operazione non si può annullare.`)) return
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
            <strong>{overused.length} cart{overused.length === 1 ? 'a' : 'e'}</strong> {overused.length === 1 ? 'è usata' : 'sono usate'} in più liste di quante copie possiedi:{' '}
            {overused.slice(0, 4).map((i, n) => (
              <span key={i.id}>
                {n > 0 && ', '}
                <strong>{i.card.name}</strong> ({i.quantity + i.used_elsewhere} usate / {i.owned} possedut{i.owned === 1 ? 'a' : 'e'})
              </span>
            ))}
            {overused.length > 4 && ` e altre ${overused.length - 4}`}.
          </span>
          <button type="button" className="ml-auto text-[13px] text-accent hover:text-accent-hi" onClick={() => { setTab('cards'); setOwn('overused') }}>
            Mostra solo queste
          </button>
        </div>
      )}

      <div role="tablist" className="flex items-center gap-6 border-b border-line">
        {(['cards', 'stats'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={clsx('-mb-px min-h-11 border-b-2 px-1 text-sm font-medium', tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')} onClick={() => setTab(t)}>
            {t === 'cards' ? 'Carte' : 'Stats'}
          </button>
        ))}
        <span className="flex-1" />
        {tab === 'cards' && (
          <div className="flex items-center gap-2 pb-1.5">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Raggruppa
              <select className="field min-h-9" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="color">Colore</option>
                <option value="type">Tipo</option>
                <option value="mv">Mana value</option>
              </select>
            </label>
            <div role="group" aria-label="Vista" className="flex rounded-[9px] border border-line bg-[#15171D] p-[3px]">
              <button type="button" aria-label="Colonne" aria-pressed={view === 'columns'} className={clsx('seg px-2.5', view === 'columns' && 'seg-on')} onClick={() => setView('columns')}>
                <Rows3 size={16} />
              </button>
              <button type="button" aria-label="Immagini" aria-pressed={view === 'grid'} className={clsx('seg px-2.5', view === 'grid' && 'seg-on')} onClick={() => setView('grid')}>
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
            <div role="group" aria-label="Filtra per possesso" className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', `Tutte ${counts.all}`],
                  ['owned', `Possedute ${counts.owned}`],
                  ['partial', `Parziali ${counts.partial}`],
                  ['not_owned', `Non possedute ${counts.not_owned}`],
                  ...(counts.overused ? [['overused', `Copie insufficienti ${counts.overused}`]] : []),
                ] as [OwnFilter, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={own === k} className={clsx('min-h-[34px] rounded-full border px-3 text-[12.5px] font-medium', own === k ? 'border-[#3A3F4B] bg-chip text-fg' : 'border-line-2 text-muted hover:text-fg')} onClick={() => setOwn(k)}>
                  {label}
                </button>
              ))}
            </div>
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
              <span className="flex h-[26px] items-end gap-[3px]" aria-label="Curva di mana">
                {stats.curve.map((b) => {
                  const max = Math.max(1, ...stats.curve.map((x) => x.value))
                  return <span key={b.key} title={`MV ${b.label}: ${b.value}`} className="w-[9px] rounded-[2px] bg-accent" style={{ height: Math.max(2, (b.value / max) * 26) }} />
                })}
              </span>
              {stats.avgMv != null && <span className="font-mono text-fg">MV medio {stats.avgMv.toFixed(2).replace('.', ',')}</span>}
            </div>
          )}

          {items.length === 0 ? (
            <div className="panel px-6 py-14 text-center text-sm text-muted">
              Lista vuota. Aggiungi carte con il campo qui sopra, oppure dalla Collezione con “Aggiungi a lista” o con la selezione multipla.
            </div>
          ) : shown.length === 0 ? (
            <div className="panel px-6 py-10 text-center text-sm text-muted">Nessuna carta con questo filtro.</div>
          ) : view === 'columns' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-3.5">
              {groups.map((g) => (
                <section key={g.key} className="overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="flex items-center justify-between border-t-[3px] bg-[#171920] px-3 py-2.5" style={{ borderTopColor: g.color }}>
                    <h2 className="m-0 text-[13px] font-semibold">{g.title}</h2>
                    <span className="font-mono text-xs text-dim">{g.items.reduce((n, i) => n + i.quantity, 0)}</span>
                  </div>
                  <div className="p-1.5">
                    {g.items.map((i) => (
                      <ItemRow key={i.id} item={i} onQty={setQty} onOpen={(it) => setDetailId(it.scryfall_id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <section key={g.key} className="flex flex-col gap-3">
                  <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                    {g.title} <span className="font-mono text-xs font-normal text-dim">{g.items.reduce((n, i) => n + i.quantity, 0)}</span>
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                    {g.items.map((i) => (
                      <ItemTile key={i.id} item={i} onQty={setQty} onOpen={(it) => setDetailId(it.scryfall_id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <label className="flex items-center gap-2 self-start text-[13px] text-muted">
            <input type="checkbox" className="h-[15px] w-[15px] accent-accent" checked={includeNotOwned} onChange={(e) => setIncludeNotOwned(e.target.checked)} />
            Includi le copie non possedute
          </label>
          <StatsView stats={stats} showPurchase={false} topTitle="Carte di maggior valore nella lista" />
        </>
      )}

      <CardDetailDrawer card={detailCard} onClose={() => setDetailId(null)} />
    </>
  )
}
