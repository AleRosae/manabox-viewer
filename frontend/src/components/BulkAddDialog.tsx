import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { addToList } from '../lib/listActions'
import type { Entry } from '../lib/types'
import { useCollectionIndex, useData } from '../store/data'
import { QtyStepper } from './QtyStepper'

interface Props {
  listId: number
  entries: Entry[]
  onClose: (done: boolean) => void
}

/** Review step for bulk adds: one stepper per card, prefilled with 1 copy. */
export function BulkAddDialog({ listId, entries, onClose }: Props) {
  const index = useCollectionIndex()
  const usage = useData((s) => s.usage)
  const listName = useData((s) => s.lists.find((l) => l.id === listId)?.name ?? 'lista')
  const [busy, setBusy] = useState(false)

  // Several entries can share a card (binder scope, different printings): merge them by oracle id.
  const cards = useMemo(() => {
    const byOracle = new Map<string, Entry>()
    for (const e of entries) if (!byOracle.has(e.card.oracle_id)) byOracle.set(e.card.oracle_id, e)
    return [...byOracle.values()].map((e) => {
      const owned = index?.ownedByOracle.get(e.card.oracle_id) ?? 0
      const inThis = usage[e.card.oracle_id]?.[String(listId)] ?? 0
      const elsewhere = Object.entries(usage[e.card.oracle_id] ?? {}).reduce((n, [lid, q]) => (lid === String(listId) ? n : n + q), 0)
      return { entry: e, owned, inThis, elsewhere, available: Math.max(0, owned - inThis) }
    })
  }, [entries, index, usage, listId])

  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(cards.map((c) => [c.entry.card.oracle_id, Math.min(1, c.available)])),
  )
  const total = Object.values(qty).reduce((a, b) => a + b, 0)

  const preset = (mode: 'one' | 'all') =>
    setQty(Object.fromEntries(cards.map((c) => [c.entry.card.oracle_id, mode === 'one' ? Math.min(1, c.available) : c.available])))

  const submit = async () => {
    setBusy(true)
    try {
      await addToList(
        listId,
        cards.map((c) => ({
          scryfall_id: index?.bestPrintByOracle.get(c.entry.card.oracle_id) ?? c.entry.card.id,
          quantity: qty[c.entry.card.oracle_id] ?? 0,
        })),
      )
      onClose(true)
    } catch {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[520px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-[14px] border border-[#3A3F4B] bg-raised p-5 shadow-[0_24px_60px_rgba(0,0,0,.65)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 text-base font-semibold">Aggiungi a {listName}</Dialog.Title>
              <Dialog.Description className="m-0 mt-0.5 text-xs text-dim">
                {cards.length} carte · scegli quante copie aggiungere per ognuna
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-2 -mt-2" aria-label="Chiudi">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            Imposta tutte:
            <button type="button" className="min-h-8 rounded-full border border-line-3 px-2.5 hover:border-accent hover:text-fg" onClick={() => preset('one')}>
              1 per carta
            </button>
            <button type="button" className="min-h-8 rounded-full border border-line-3 px-2.5 hover:border-accent hover:text-fg" onClick={() => preset('all')}>
              Tutte le disponibili
            </button>
          </div>

          <ul className="-mx-1 m-0 flex-1 list-none overflow-y-auto p-0 px-1">
            {cards.map((c) => {
              const id = c.entry.card.oracle_id
              const value = qty[id] ?? 0
              return (
                <li key={id} className={clsx('flex items-center gap-3 border-t border-chip py-2', c.available === 0 && value === 0 && 'opacity-55')}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{c.entry.card.name}</span>
                    <span className="text-[11.5px] text-dim">
                      {c.owned} possedut{c.owned === 1 ? 'a' : 'e'}
                      {c.inThis > 0 && ` · già ${c.inThis} in questa lista`}
                      {c.elsewhere > 0 && ` · ${c.elsewhere} in altre liste`}
                    </span>
                  </div>
                  <QtyStepper size="sm" value={value} of={c.available} onChange={(v) => setQty((q) => ({ ...q, [id]: v }))} />
                </li>
              )
            })}
          </ul>

          <div className="flex justify-end gap-2 pt-1">
            <Dialog.Close className="btn">Indietro</Dialog.Close>
            <button type="button" className="btn btn-primary" disabled={busy || total === 0} onClick={() => void submit()}>
              Aggiungi {total} {total === 1 ? 'copia' : 'copie'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
