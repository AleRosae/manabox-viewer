import * as Popover from '@radix-ui/react-popover'
import clsx from 'clsx'
import { ArrowRightLeft } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { BOARD_LABEL, BOARD_ORDER } from '../../lib/listGroups'
import type { ListItem } from '../../lib/types'
import { useData } from '../../store/data'

/** Button + menu moving a deck card to another board (copies already there are merged). */
export function BoardMenu({ listId, item, className }: { listId: number; item: ListItem; className?: string }) {
  const [open, setOpen] = useState(false)
  const move = async (board: ListItem['board']) => {
    setOpen(false)
    try {
      await api.updateItem(listId, item.id, { board })
      await useData.getState().listsChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Move ${item.card.name} to another board`}
        className={clsx('flex items-center justify-center rounded text-muted hover:bg-chip hover:text-fg', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <ArrowRightLeft size={13} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 flex w-48 flex-col rounded-xl border border-[#3A3F4B] bg-raised p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.55)]"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="facet px-2.5 pb-1 pt-1.5">Move to</span>
          {BOARD_ORDER.filter((b) => b !== item.board).map((b) => (
            <button key={b} type="button" className="rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-panel-2" onClick={() => void move(b)}>
              {BOARD_LABEL[b]}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
