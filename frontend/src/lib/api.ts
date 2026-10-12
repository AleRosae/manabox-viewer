import type { Board, Card, CollectionData, DeckFormat, ImportDiff, ImportInfo, ListDetail, ListImportPreview, ListKind, ListSummary, ListToken, MoxfieldDeck, RemoteSource, Status, SyncDiff, Usage } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init)
  if (!resp.ok) {
    let message = `Error ${resp.status}`
    try {
      const body = await resp.json()
      if (typeof body?.detail === 'string') message = body.detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(resp.status, message)
  }
  if (resp.status === 204) return undefined as T
  return resp.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface BulkApplied {
  oracle_id: string
  scryfall_id: string
  name: string
  board: Board
  delta: number
}

/** Without a board, copies are added to the main deck and removed from the last board holding the card. */
export interface BulkItem {
  scryfall_id: string
  quantity: number
  board?: Board
}

export type ExportFormat = 'cubecobra_csv' | 'txt' | 'deck' | 'viewer' | 'missing' | 'missing_names' | 'tokens' | 'tokens_missing'

/** What a Moxfield deck is read from: its text export (plus the deck URL to link to) or the bookmarklet. */
export interface MoxfieldSource {
  deck?: string
  text?: string
  payload?: MoxfieldDeck
}

export const api = {
  status: () => request<Status>('/api/status'),
  collection: () => request<CollectionData>('/api/collection'),
  uploadImport: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ id: number }>('/api/imports', { method: 'POST', body: form })
  },
  getImport: (id: number) => request<ImportInfo>(`/api/imports/${id}`),
  importDiff: (id: number) => request<ImportDiff | null>(`/api/imports/${id}/diff`),
  refreshPrices: () => request<unknown>('/api/prices/refresh', { method: 'POST' }),
  retryPendingCards: () => request<unknown>('/api/imports/retry', { method: 'POST' }),

  lists: () => request<ListSummary[]>('/api/lists'),
  usage: () => request<Usage>('/api/lists/usage'),
  list: (id: number) => request<ListDetail>(`/api/lists/${id}`),
  createList: (name: string, kind: ListKind, format?: DeckFormat) => request<ListSummary>('/api/lists', json('POST', { name, kind, format })),
  updateList: (id: number, patch: Partial<Pick<ListSummary, 'name' | 'description' | 'format'>> & { unlink?: boolean }) =>
    request<ListSummary>(`/api/lists/${id}`, json('PATCH', patch)),
  deleteList: (id: number) => request<void>(`/api/lists/${id}`, { method: 'DELETE' }),
  bulkItems: (id: number, items: BulkItem[]) => request<{ applied: BulkApplied[] }>(`/api/lists/${id}/items/bulk`, json('POST', { items })),
  updateItem: (listId: number, itemId: number, patch: { quantity?: number; preferred_scryfall_id?: string; tags?: string[]; board?: Board }) =>
    request<unknown>(`/api/lists/${listId}/items/${itemId}`, json('PATCH', patch)),
  deleteItem: (listId: number, itemId: number) =>
    request<void>(`/api/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
  tokens: (id: number) => request<ListToken[]>(`/api/lists/${id}/tokens`),
  /** `quantity` null goes back to the default */
  updateToken: (id: number, oracleId: string, patch: { quantity: number | null; hidden: boolean }) =>
    request<unknown>(`/api/lists/${id}/tokens/${oracleId}`, json('PATCH', patch)),
  exportUrl: (id: number, format: ExportFormat) => `/api/lists/${id}/export?format=${format}`,
  previewListImport: (text: string) => request<ListImportPreview>('/api/lists/import/preview', json('POST', { text })),
  importList: (body: {
    name: string
    kind: ListKind
    format?: DeckFormat | null
    shared_by: string | null
    remote_source?: RemoteSource | null
    remote_id?: string | null
    items: { scryfall_id: string; quantity: number; board: Board; their_owned: number | null; tags: string[]; cube_statuses?: string[] | null }[]
  }) => request<ListSummary>('/api/lists/import', json('POST', body)),
  previewCube: (url: string) => request<ListImportPreview>('/api/cubes/cubecobra/preview', json('POST', { url })),
  /** `cube` links the list to another cube (saved only with `apply`) */
  syncCube: (id: number, body: { cube?: string; apply?: boolean }) => request<SyncDiff>(`/api/cubes/${id}/sync`, json('POST', body)),
  previewMoxfield: (source: MoxfieldSource) => request<ListImportPreview>('/api/decks/moxfield/preview', json('POST', source)),
  /** `deck` links the list to another deck (saved only with `apply`) */
  syncDeck: (id: number, body: MoxfieldSource & { apply?: boolean }) => request<SyncDiff>(`/api/decks/${id}/sync`, json('POST', body)),

  autocomplete: (q: string) => request<string[]>(`/api/scryfall/autocomplete?q=${encodeURIComponent(q)}`),
  named: (name: string) => request<Card>(`/api/scryfall/named?name=${encodeURIComponent(name)}`),
  prints: (oracleId: string) => request<Card[]>(`/api/scryfall/prints/${oracleId}`),
}

export const imageUrl = (id: string, size: 'normal' | 'large' = 'normal', face = 0) =>
  `/api/images/${id}?size=${size}&face=${face}`
