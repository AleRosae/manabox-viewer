import clsx from 'clsx'
import { Check, Plus, RefreshCw } from 'lucide-react'
import { memo, useState } from 'react'
import { fmtEur, isDoubleFaced } from '../lib/cards'
import type { Entry } from '../lib/types'
import { AddToListPopover } from './AddToList'
import { CardImage } from './CardImage'
import { useHoverPreview } from './HoverPreview'

interface Props {
  entry: Entry
  index: number
  selected: boolean
  selectionMode: boolean
  showBinders: boolean
  onSelect: (key: string, index: number, shift: boolean) => void
  onOpen: (key: string) => void
}

export const CardTile = memo(function CardTile({ entry, index, selected, selectionMode, showBinders, onSelect, onOpen }: Props) {
  const [face, setFace] = useState(0)
  const hover = useHoverPreview(entry.card)
  const dfc = isDoubleFaced(entry.card)
  const rarity = entry.card.rarity[0]?.toUpperCase()

  return (
    <div className="group flex flex-col gap-2">
      <div
        className={clsx(
          'relative cursor-pointer rounded-[11px] outline-offset-2 transition-[outline-color]',
          selected ? 'outline-2 outline-accent' : 'outline-2 outline-transparent',
        )}
        {...hover}
        onClick={(e) => {
          if (selectionMode || e.shiftKey || e.metaKey || e.ctrlKey) onSelect(entry.key, index, e.shiftKey)
          else onOpen(entry.key)
        }}
      >
        <CardImage card={entry.card} face={face} />

        <label
          className={clsx(
            'absolute left-1 top-1 flex h-10 w-10 cursor-pointer items-center justify-center transition-opacity',
            selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={selected}
            aria-label={`Seleziona ${entry.card.name}`}
            onChange={(e) => onSelect(entry.key, index, (e.nativeEvent as MouseEvent).shiftKey)}
          />
          <span
            className={clsx(
              'flex h-[22px] w-[22px] items-center justify-center rounded-md border-2 text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
              selected ? 'border-accent bg-accent' : 'border-muted bg-bg/75',
            )}
          >
            {selected && <Check size={14} strokeWidth={3.5} />}
          </span>
        </label>

        {entry.quantity > 1 && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-accent px-1.5 py-px font-mono text-[11px] font-bold text-accent-ink shadow group-hover:opacity-0">
            ×{entry.quantity}
          </span>
        )}

        {entry.foil && (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-bg/85 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-accent-hi group-hover:opacity-0">
            FOIL
          </span>
        )}

        {dfc && (
          <button
            type="button"
            aria-label="Gira la carta"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-bg/85 text-fg hover:bg-chip"
            onClick={(e) => {
              e.stopPropagation()
              setFace((f) => 1 - f)
            }}
          >
            <RefreshCw size={15} />
          </button>
        )}

        {!selectionMode && (
          <AddToListPopover card={entry.card}>
            <button
              type="button"
              className="absolute inset-x-2 bottom-2 flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-semibold text-accent-ink opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <Plus size={14} strokeWidth={2.5} /> Aggiungi a lista
            </button>
          </AddToListPopover>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-1.5 px-0.5">
        <span className="truncate font-mono text-[11px] text-dim" title={entry.binders.join(', ')}>
          {showBinders
            ? `${entry.binders.length > 1 ? `${entry.binders.length} binder` : entry.binders[0]}`
            : `${entry.card.set.toUpperCase()} · ${rarity}`}
        </span>
        <span className="font-mono text-[13px] font-medium">{fmtEur(entry.unitMarket)}</span>
      </div>
    </div>
  )
})
