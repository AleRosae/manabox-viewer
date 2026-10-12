import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { addToList, createList } from '../lib/listActions'
import type { Card, ListKind } from '../lib/types'
import { getLastListId, useCollectionIndex, useData } from '../store/data'
import { QtyStepper } from './QtyStepper'

/** A cube or deck, or one to create. */
export type ListTarget = number | `new:${ListKind}`

export const isNewTarget = (v: ListTarget): v is `new:${ListKind}` => typeof v === 'string'
const newKind = (v: `new:${ListKind}`) => v.slice(4) as ListKind

/** Native select with the user's cubes and decks, plus "new cube" and "new deck". */
export function ListPicker({
  value,
  onChange,
  newName,
  onNewName,
  className,
}: {
  value: ListTarget
  onChange: (v: ListTarget) => void
  newName: string
  onNewName: (v: string) => void
  className?: string
}) {
  const lists = useData((s) => s.lists)
  return (
    <div className={className}>
      <select
        aria-label="Target list"
        className="field w-full"
        value={value}
        onChange={(e) => onChange(e.target.value.startsWith('new:') ? (e.target.value as ListTarget) : Number(e.target.value))}
      >
        {(['cube', 'deck'] as ListKind[]).map((kind) => {
          const ofKind = lists.filter((l) => l.kind === kind)
          return ofKind.length ? (
            <optgroup key={kind} label={kind === 'cube' ? 'Cubes' : 'Decks'}>
              {ofKind.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ) : null
        })}
        <option value="new:cube">+ New cube…</option>
        <option value="new:deck">+ New deck…</option>
      </select>
      {isNewTarget(value) && (
        <input
          autoFocus
          aria-label={`New ${newKind(value)} name`}
          placeholder={`New ${newKind(value)} name`}
          className="field mt-2 w-full"
          value={newName}
          onChange={(e) => onNewName(e.target.value)}
        />
      )}
    </div>
  )
}

export function useDefaultList(): ListTarget {
  const lists = useData((s) => s.lists)
  const last = getLastListId()
  if (last && lists.some((l) => l.id === last)) return last
  return lists[0]?.id ?? 'new:cube'
}

/** Resolves the picker value to a list id, creating the cube or deck if needed. */
export async function resolveList(value: ListTarget, newName: string): Promise<number | null> {
  if (!isNewTarget(value)) return value
  if (!newName.trim()) return null
  return (await createList(newName, newKind(value))).id
}

export function availability(listId: ListTarget, owned: number, usage: Record<string, number>) {
  const inThis = isNewTarget(listId) ? 0 : (usage[String(listId)] ?? 0)
  const elsewhere = Object.entries(usage).reduce((n, [lid, q]) => (lid === String(listId) ? n : n + q), 0)
  return { inThis, elsewhere, available: Math.max(0, owned - inThis) }
}

export function AvailabilityText({ owned, inThis, elsewhere, available }: { owned: number; inThis: number; elsewhere: number; available: number }) {
  if (owned === 0) return <span className="text-xs text-dim">Not owned: it will be marked as such in the list</span>
  return (
    <span className="text-xs text-[#C9B48A]">
      {available} of {owned} owned available
      {inThis > 0 && ` · ${inThis} already in this list`}
      {elsewhere > 0 && ` · ${elsewhere} in other lists`}
    </span>
  )
}

/** Inline form: destination list + number of copies. */
export function AddToListForm({ card, onDone }: { card: Card; onDone?: () => void }) {
  const index = useCollectionIndex()
  const allUsage = useData((s) => s.usage)
  const usage = allUsage[card.oracle_id] ?? {}
  const [listId, setListId] = useState<ListTarget>(useDefaultList())
  const [newName, setNewName] = useState('')
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const owned = index?.ownedByOracle.get(card.oracle_id) ?? 0
  const avail = availability(listId, owned, usage)

  const submit = async () => {
    setBusy(true)
    try {
      const id = await resolveList(listId, newName)
      if (id == null) return
      // Prefer the most valuable owned printing; otherwise the card shown.
      const scryfallId = index?.bestPrintByOracle.get(card.oracle_id) ?? card.id
      await addToList(id, [{ scryfall_id: scryfallId, quantity: qty }])
      onDone?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-wrap items-start gap-2.5">
        <ListPicker className="min-w-44 flex-1" value={listId} onChange={setListId} newName={newName} onNewName={setNewName} />
        <QtyStepper value={qty} onChange={setQty} min={1} />
        <button type="submit" className="btn btn-primary" disabled={busy || (isNewTarget(listId) && !newName.trim())}>
          Add
        </button>
      </div>
      <AvailabilityText owned={owned} {...avail} />
    </form>
  )
}

export function AddToListPopover({ card, children }: { card: Card; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-40 w-[380px] max-w-[calc(100vw-24px)] rounded-xl border border-line-3 bg-raised p-4 shadow-[0_20px_50px_rgba(0,0,0,.6)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 text-[15px] font-semibold">
            Add <span className="text-accent">{card.name}</span>
          </div>
          <AddToListForm card={card} onDone={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
