import clsx from 'clsx'
import { AlertCircle, Minus, Plus, Trash2 } from 'lucide-react'
import { fmtEur, isLand } from '../../lib/cards'
import { type ItemGroup, isOverused } from '../../lib/listGroups'
import type { ListItem } from '../../lib/types'
import { CardImage } from '../CardImage'
import { useHoverPreview } from '../HoverPreview'
import { TagEditor } from '../TagEditor'
import { BoardMenu } from './BoardMenu'

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

/** Shown while the hover controls of a row/tile are visible: on hover or while one of their popovers is open. */
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

/** Red mark on cards that break the deck's format rules. */
const IssueMark = ({ issue }: { issue?: string }) =>
  issue ? (
    <span title={issue} className="flex shrink-0 text-bad">
      <AlertCircle size={13} aria-label={issue} />
    </span>
  ) : null

export interface ItemActions {
  listId: number
  knownTags: string[]
  /** decks: cards can move between boards */
  boards: boolean
  /** why a card breaks the format, by oracle id */
  issues: Map<string, string>
  onQty: (item: ListItem, q: number) => void
  onOpen: (item: ListItem) => void
}

function ItemRow({ item, actions }: { item: ListItem; actions: ItemActions }) {
  const { listId, knownTags, boards, issues, onQty, onOpen } = actions
  const hover = useHoverPreview(item.card, item.ownership === 'not_owned')
  const notOwned = item.ownership === 'not_owned'
  return (
    <div className={clsx('group flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-panel-2', isOverused(item) && 'bg-warn-bg', notOwned && 'opacity-50 hover:opacity-80')}>
      <IssueMark issue={issues.get(item.oracle_id)} />
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
        {boards && <BoardMenu listId={listId} item={item} className="h-6 w-6" />}
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

function ItemTile({ item, actions }: { item: ListItem; actions: ItemActions }) {
  const { listId, knownTags, boards, issues, onQty, onOpen } = actions
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
          {boards && <BoardMenu listId={listId} item={item} className="h-8 w-8 rounded-lg bg-bg/90" />}
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
        <span className="flex min-w-0 items-center gap-1">
          <IssueMark issue={issues.get(item.oracle_id)} />
          <span className="truncate text-dim">{item.card.name}</span>
        </span>
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

/** Light line between the sub-groups of a group, as on CubeCobra. */
const SubgroupSeparator = ({ className }: { className?: string }) => <hr aria-hidden="true" className={clsx('m-0 h-px border-0 bg-line-2', className)} />

/** Groups as cube-style columns or as image sections, their sub-groups split by a separator. */
export function GroupedItems({ groups, view, actions }: { groups: ItemGroup[]; view: 'columns' | 'grid'; actions: ItemActions }) {
  if (view === 'columns')
    return (
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
              {g.subgroups.map((sub, n) => (
                <div key={sub.key}>
                  {n > 0 && <SubgroupSeparator className="mx-2 my-1.5" />}
                  {sub.items.map((i) => (
                    <ItemRow key={i.id} item={i} actions={actions} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  return (
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
          {g.subgroups.map((sub, n) => (
            <div key={sub.key} className="flex flex-col gap-3">
              {n > 0 && <SubgroupSeparator />}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                {sub.items.map((i) => (
                  <ItemTile key={i.id} item={i} actions={actions} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
