import type { ListKind } from './types'

export const KIND_PATH: Record<ListKind, string> = { cube: '/cubes', deck: '/decks' }

/** The page of a cube or deck. */
export const listPath = (list: { id: number; kind: ListKind }) => `${KIND_PATH[list.kind]}/${list.id}`
