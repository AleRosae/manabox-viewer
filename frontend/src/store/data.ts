import { useMemo } from 'react'
import { create } from 'zustand'
import { api } from '../lib/api'
import { indexCollection } from '../lib/cards'
import type { CollectionData, ListSummary, Status, Usage } from '../lib/types'

interface DataState {
  status: Status | null
  collection: CollectionData | null
  lists: ListSummary[]
  usage: Usage
  /** bumped after list changes so open list views refetch */
  listsVersion: number
  loadStatus: () => Promise<Status>
  loadCollection: () => Promise<void>
  loadLists: () => Promise<void>
  /** refresh lists + usage after any list mutation */
  listsChanged: () => Promise<void>
}

export const useData = create<DataState>((set, get) => ({
  status: null,
  collection: null,
  lists: [],
  usage: {},
  listsVersion: 0,
  loadStatus: async () => {
    const status = await api.status()
    set({ status })
    return status
  },
  loadCollection: async () => {
    set({ collection: await api.collection() })
  },
  loadLists: async () => {
    const [lists, usage] = await Promise.all([api.lists(), api.usage()])
    set({ lists, usage })
  },
  listsChanged: async () => {
    await get().loadLists()
    set((s) => ({ listsVersion: s.listsVersion + 1 }))
  },
}))

export const useUsdRate = () => useData((s) => s.status?.usd_to_eur ?? 0.92)

export function useCollectionIndex() {
  const collection = useData((s) => s.collection)
  const rate = useUsdRate()
  return useMemo(
    () => (collection ? indexCollection(collection.rows, collection.cards, rate) : null),
    [collection, rate],
  )
}

const LAST_LIST_KEY = 'mbv:lastList'

export function getLastListId(): number | null {
  try {
    const v = localStorage.getItem(LAST_LIST_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function setLastListId(id: number) {
  try {
    localStorage.setItem(LAST_LIST_KEY, String(id))
  } catch {
    /* storage unavailable */
  }
}
