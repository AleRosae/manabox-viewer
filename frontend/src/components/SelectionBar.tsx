import { X } from 'lucide-react'
import { useState } from 'react'
import { createList } from '../lib/listActions'
import type { Entry } from '../lib/types'
import { useSelection } from '../store/ui'
import { ListPicker, useDefaultList } from './AddToList'
import { BulkAddDialog } from './BulkAddDialog'

interface Props {
  visible: Entry[]
}

export function SelectionBar({ visible }: Props) {
  const { selected, mode, selectAll, setMode } = useSelection()
  const defaultList = useDefaultList()
  const [listId, setListId] = useState<number | 'new'>(defaultList)
  const [newName, setNewName] = useState('')
  const [reviewing, setReviewing] = useState<number | null>(null)

  if (!mode && selected.size === 0) return null
  const chosen = visible.filter((e) => selected.has(e.key))
  const allSelected = chosen.length === visible.length && visible.length > 0

  const openReview = async () => {
    if (listId === 'new') {
      if (!newName.trim()) return
      const list = await createList(newName)
      setListId(list.id)
      setNewName('')
      setReviewing(list.id)
    } else {
      setReviewing(listId)
    }
  }

  return (
    <>
      <div className="sticky bottom-5 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-[#3A3F4B] bg-raised py-2.5 pl-[18px] pr-3 shadow-[0_20px_50px_rgba(0,0,0,.6)]">
        <span className="text-sm">
          <span className="font-mono font-semibold text-accent">{chosen.length}</span> selected
        </span>
        <button
          type="button"
          className="min-h-10 text-[13px] font-medium underline underline-offset-[3px] hover:text-accent"
          onClick={() => (allSelected ? useSelection.getState().clear() : selectAll(visible.map((e) => e.key)))}
        >
          {allSelected ? 'Deselect all' : `Select all ${visible.length} filtered`}
        </button>
        <span className="flex-1" />
        <span className="text-[13px] text-muted">Add to</span>
        <ListPicker className="w-56" value={listId} onChange={setListId} newName={newName} onNewName={setNewName} />
        <button type="button" className="btn btn-primary" disabled={chosen.length === 0 || (listId === 'new' && !newName.trim())} onClick={() => void openReview()}>
          Add…
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Cancel selection" onClick={() => setMode(false)}>
          <X size={16} />
        </button>
      </div>
      {reviewing != null && (
        <BulkAddDialog
          listId={reviewing}
          entries={chosen}
          onClose={(done) => {
            setReviewing(null)
            if (done) setMode(false)
          }}
        />
      )}
    </>
  )
}
