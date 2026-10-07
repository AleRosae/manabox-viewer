import { toast } from 'sonner'
import { setLastListId, useData } from '../store/data'
import { api } from './api'
import type { ListKind } from './types'

export interface AddItem {
  scryfall_id: string
  quantity: number
}

/** Adds copies to a list, then shows a toast with an undo action. */
export async function addToList(listId: number, items: AddItem[]): Promise<void> {
  const wanted = items.filter((i) => i.quantity > 0)
  if (!wanted.length) {
    toast.info('Nessuna copia da aggiungere')
    return
  }
  const listName = useData.getState().lists.find((l) => l.id === listId)?.name ?? 'lista'
  try {
    const { applied } = await api.bulkItems(listId, wanted)
    setLastListId(listId)
    await useData.getState().listsChanged()
    const copies = applied.reduce((n, a) => n + a.delta, 0)
    const label =
      applied.length === 1
        ? `${applied[0].delta}× ${applied[0].name} aggiunt${applied[0].delta === 1 ? 'a' : 'e'} a ${listName}`
        : `${copies} copie (${applied.length} carte) aggiunte a ${listName}`
    toast.success(label, {
      action: {
        label: 'Annulla',
        onClick: async () => {
          await api.bulkItems(
            listId,
            applied.map((a) => ({ scryfall_id: a.scryfall_id, quantity: -a.delta })),
          )
          await useData.getState().listsChanged()
          toast('Aggiunta annullata')
        },
      },
    })
  } catch (err) {
    toast.error(`Impossibile aggiungere: ${(err as Error).message}`)
    throw err
  }
}

export async function createList(name: string, kind: ListKind = 'generic') {
  const list = await api.createList(name.trim(), kind)
  await useData.getState().listsChanged()
  return list
}
