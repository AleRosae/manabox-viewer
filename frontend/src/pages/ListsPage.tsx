import clsx from 'clsx'
import { Boxes, FileDown } from 'lucide-react'
import { useState } from 'react'
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom'
import { ImportListDialog } from '../components/ImportListDialog'
import { ListDetailView } from '../components/ListDetailView'
import { createList } from '../lib/listActions'
import type { ListKind } from '../lib/types'
import { getLastListId, useData } from '../store/data'

function NewListForm() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ListKind>('cube')
  if (!open)
    return (
      <button type="button" className="mt-2 min-h-11 rounded-[9px] border border-dashed border-[#3A3F4B] text-[13px] font-semibold text-accent hover:border-accent" onClick={() => setOpen(true)}>
        + New list
      </button>
    )
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line-2 bg-panel p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const list = await createList(name, kind)
        setName('')
        setOpen(false)
        navigate(`/lists/${list.id}`)
      }}
    >
      <input autoFocus className="field" placeholder="List name" aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex rounded-[9px] border border-line bg-panel-2 p-[3px]" role="group" aria-label="List type">
        <button type="button" className={clsx('seg flex-1', kind === 'cube' && 'seg-on')} onClick={() => setKind('cube')}>
          Cube
        </button>
        <button type="button" className={clsx('seg flex-1', kind === 'generic' && 'seg-on')} onClick={() => setKind('generic')}>
          Generic
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Create
        </button>
      </div>
    </form>
  )
}

function ImportListButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="flex min-h-11 items-center justify-center gap-2 rounded-[9px] text-[13px] font-semibold text-muted hover:bg-panel-2 hover:text-fg" onClick={() => setOpen(true)}>
        <FileDown size={15} /> Import list
      </button>
      {open && <ImportListDialog onClose={() => setOpen(false)} />}
    </>
  )
}

export function ListsPage() {
  const lists = useData((s) => s.lists)
  const { id } = useParams()

  if (!id && lists.length) {
    const last = getLastListId()
    const target = lists.find((l) => l.id === last) ?? lists[0]
    return <Navigate to={`/lists/${target.id}`} replace />
  }

  return (
    <div className="flex flex-1 flex-wrap">
      <aside className="flex w-full flex-col gap-1.5 border-line bg-side px-4 py-[22px] lg:sticky lg:top-[69px] lg:max-h-[calc(100vh-69px)] lg:w-[280px] lg:overflow-y-auto lg:border-r">
        <span className="facet px-1.5 pb-2.5">Your lists</span>
        {lists.map((l) => (
          <NavLink
            key={l.id}
            to={`/lists/${l.id}`}
            className={({ isActive }) =>
              clsx('flex min-h-11 items-center justify-between gap-2 rounded-[9px] px-3 text-sm', isActive ? 'bg-[#1D2028] text-fg' : 'text-soft hover:bg-panel-2')
            }
          >
            <span className="truncate">{l.name}</span>
            <span className="font-mono text-xs text-dim">{l.card_count}</span>
          </NavLink>
        ))}
        <NewListForm />
        <ImportListButton />
      </aside>

      <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-5 px-4 pb-14 pt-6 sm:px-8">
        {id ? (
          <ListDetailView key={id} listId={Number(id)} />
        ) : (
          <div className="panel flex flex-col items-center gap-3 px-6 py-20 text-center">
            <Boxes size={32} className="text-accent" />
            <span className="text-lg font-semibold">No lists yet</span>
            <span className="max-w-md text-sm text-muted">
              Create a cube or a generic list, then add cards from your collection (one by one or with multi-selection) or by searching Scryfall. Got a list from a friend? Import it.
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
