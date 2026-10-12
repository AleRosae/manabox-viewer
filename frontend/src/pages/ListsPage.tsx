import clsx from 'clsx'
import { Boxes, FileDown, Layers } from 'lucide-react'
import { useState } from 'react'
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom'
import { ImportListDialog } from '../components/ImportListDialog'
import { ListDetailView } from '../components/list/ListDetailView'
import { MoxfieldBookmarklet } from '../components/list/MoxfieldBookmarklet'
import { FORMAT_ORDER, FORMATS } from '../lib/legality'
import { createList } from '../lib/listActions'
import { listPath } from '../lib/paths'
import type { DeckFormat, ListKind } from '../lib/types'
import { getLastListId, useData } from '../store/data'

const NOUN: Record<ListKind, string> = { cube: 'cube', deck: 'deck' }

function NewListForm({ kind }: { kind: ListKind }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [format, setFormat] = useState<DeckFormat>('commander')
  if (!open)
    return (
      <button type="button" className="mt-2 min-h-11 rounded-[9px] border border-dashed border-[#3A3F4B] text-[13px] font-semibold text-accent hover:border-accent" onClick={() => setOpen(true)}>
        + New {NOUN[kind]}
      </button>
    )
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line-2 bg-panel p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const list = await createList(name, kind, kind === 'deck' ? format : undefined)
        setName('')
        setOpen(false)
        navigate(listPath(list))
      }}
    >
      <input autoFocus className="field" placeholder={kind === 'deck' ? 'Deck name' : 'Cube name'} aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      {kind === 'deck' && (
        <select className="field" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as DeckFormat)}>
          {FORMAT_ORDER.map((f) => (
            <option key={f} value={f}>
              {FORMATS[f].label}
            </option>
          ))}
        </select>
      )}
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

function ImportListButton({ kind }: { kind: ListKind }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="flex min-h-11 items-center justify-center gap-2 rounded-[9px] text-[13px] font-semibold text-muted hover:bg-panel-2 hover:text-fg" onClick={() => setOpen(true)}>
        <FileDown size={15} /> Import {NOUN[kind]}
      </button>
      {open && <ImportListDialog kind={kind} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Cubes or decks: the sidebar with the lists of that kind, and the open one. */
export function ListsPage({ kind }: { kind: ListKind }) {
  const allLists = useData((s) => s.lists)
  const lists = allLists.filter((l) => l.kind === kind)
  const { id } = useParams()

  if (!id && lists.length) {
    const last = getLastListId(kind)
    const target = lists.find((l) => l.id === last) ?? lists[0]
    return <Navigate to={listPath(target)} replace />
  }

  return (
    <div className="flex flex-1 flex-wrap">
      <aside className="flex w-full flex-col gap-1.5 border-line bg-side px-4 py-[22px] lg:sticky lg:top-[69px] lg:max-h-[calc(100vh-69px)] lg:w-[280px] lg:overflow-y-auto lg:border-r">
        <span className="facet px-1.5 pb-2.5">Your {NOUN[kind]}s</span>
        {lists.map((l) => (
          <NavLink
            key={l.id}
            to={listPath(l)}
            className={({ isActive }) =>
              clsx('flex min-h-11 items-center justify-between gap-2 rounded-[9px] px-3 text-sm', isActive ? 'bg-[#1D2028] text-fg' : 'text-soft hover:bg-panel-2')
            }
          >
            <span className="truncate">{l.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              {l.format && l.format !== 'none' && <span className="text-[11px] text-dim">{FORMATS[l.format].label}</span>}
              <span className="font-mono text-xs text-dim">{l.card_count}</span>
            </span>
          </NavLink>
        ))}
        <NewListForm kind={kind} />
        <ImportListButton kind={kind} />
        {kind === 'deck' && (
          <p className="m-0 mt-3 px-1.5 text-xs leading-relaxed text-dim">
            Import or sync a Moxfield deck in one click: drag <MoxfieldBookmarklet /> to the bookmarks bar, then click it on the deck's page.
          </p>
        )}
      </aside>

      <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-5 px-4 pb-14 pt-6 sm:px-8">
        {id ? (
          <ListDetailView key={id} listId={Number(id)} kind={kind} />
        ) : (
          <div className="panel flex flex-col items-center gap-3 px-6 py-20 text-center">
            {kind === 'deck' ? <Layers size={32} className="text-accent" /> : <Boxes size={32} className="text-accent" />}
            <span className="text-lg font-semibold">No {NOUN[kind]}s yet</span>
            <span className="max-w-md text-sm text-muted">
              {kind === 'deck'
                ? 'Create a deck and pick its format, or import one from Moxfield: the cards you own are matched with your collection, and the deck is checked against its format.'
                : 'Create a cube, then add cards from your collection (one by one or with multi-selection) or by searching Scryfall. Got a cube on CubeCobra, or a list from a friend? Import it.'}
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
