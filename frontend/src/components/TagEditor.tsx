import * as Popover from '@radix-ui/react-popover'
import clsx from 'clsx'
import { Tag, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import type { ListItem } from '../lib/types'
import { useData } from '../store/data'

/**
 * Tag button + popover to edit a list item's labels; `known` are the tags used in the list.
 *
 * While open, the popover edits its own copy of the tags and saves each change in order; the list
 * reloads only on close, so the item does not jump to another group (closing the popover) mid-edit.
 */
export function TagEditor({ listId, item, known, className }: { listId: number; item: ListItem; known: string[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const [tags, setTags] = useState(item.tags)
  const [draft, setDraft] = useState('')
  const datalist = useId()
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const dirty = useRef(false)

  const save = (next: string[]) => {
    setTags(next)
    dirty.current = true
    pending.current = pending.current
      .then(() => api.updateItem(listId, item.id, { tags: next }))
      .catch((e: Error) => toast.error(e.message))
  }
  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) {
      setTags(item.tags)
      dirty.current = false
    } else if (dirty.current) {
      void pending.current.then(() => useData.getState().listsChanged())
    }
  }
  const add = () => {
    const tag = draft.trim()
    setDraft('')
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) save([...tags, tag])
  }
  const suggestions = known.filter((k) => !tags.some((t) => t.toLowerCase() === k.toLowerCase()))

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={`Tags of ${item.card.name}`}
        className={clsx('flex items-center justify-center rounded text-muted hover:bg-chip hover:text-fg', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <Tag size={13} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 flex w-64 flex-col gap-2 rounded-xl border border-[#3A3F4B] bg-raised p-3 shadow-[0_16px_40px_rgba(0,0,0,.55)]"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="truncate text-xs text-dim">Tags · {item.card.name}</span>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-full bg-chip py-0.5 pl-2 pr-1 text-xs">
                  {t}
                  <button type="button" aria-label={`Remove tag ${t}`} className="rounded-full text-muted hover:text-fg" onClick={() => save(tags.filter((x) => x !== t))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <input
              autoFocus
              className="field min-h-8 w-full text-[13px]"
              placeholder="Add a tag and press Enter"
              aria-label="New tag"
              list={datalist}
              maxLength={40}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <datalist id={datalist}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
