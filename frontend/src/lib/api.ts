import type { Card, CollectionData, CubeSync, ImportDiff, ImportInfo, ListDetail, ListImportPreview, ListKind, ListSummary, Status, Usage } from './types'

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
  delta: number
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

  lists: () => request<ListSummary[]>('/api/lists'),
  usage: () => request<Usage>('/api/lists/usage'),
  list: (id: number) => request<ListDetail>(`/api/lists/${id}`),
  createList: (name: string, kind: ListKind) => request<ListSummary>('/api/lists', json('POST', { name, kind })),
  /** `cubecobra_id`: a cube URL or id, '' to unlink */
  updateList: (id: number, patch: Partial<Pick<ListSummary, 'name' | 'description' | 'kind'> & { cubecobra_id: string }>) =>
    request<ListSummary>(`/api/lists/${id}`, json('PATCH', patch)),
  deleteList: (id: number) => request<void>(`/api/lists/${id}`, { method: 'DELETE' }),
  bulkItems: (id: number, items: { scryfall_id: string; quantity: number }[]) =>
    request<{ applied: BulkApplied[] }>(`/api/lists/${id}/items/bulk`, json('POST', { items })),
  updateItem: (listId: number, itemId: number, patch: { quantity?: number; preferred_scryfall_id?: string; tags?: string[] }) =>
    request<unknown>(`/api/lists/${listId}/items/${itemId}`, json('PATCH', patch)),
  deleteItem: (listId: number, itemId: number) =>
    request<void>(`/api/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
  exportUrl: (id: number, format: 'cubecobra_csv' | 'txt' | 'viewer' | 'missing') => `/api/lists/${id}/export?format=${format}`,
  previewListImport: (text: string) => request<ListImportPreview>('/api/lists/import/preview', json('POST', { text })),
  importList: (body: {
    name: string
    kind: ListKind
    shared_by: string | null
    cubecobra_id?: string | null
    items: { scryfall_id: string; quantity: number; their_owned: number | null; tags: string[]; cube_statuses?: string[] }[]
  }) => request<ListSummary>('/api/lists/import', json('POST', body)),
  previewCube: (url: string) => request<ListImportPreview>('/api/lists/cubecobra/preview', json('POST', { url })),
  /** `cube` links the list to another cube (saved only with `apply`) */
  syncCube: (id: number, body: { cube?: string; apply?: boolean }) =>
    request<CubeSync>(`/api/lists/${id}/sync`, json('POST', body)),

  autocomplete: (q: string) => request<string[]>(`/api/scryfall/autocomplete?q=${encodeURIComponent(q)}`),
  named: (name: string) => request<Card>(`/api/scryfall/named?name=${encodeURIComponent(name)}`),
  prints: (oracleId: string) => request<Card[]>(`/api/scryfall/prints/${oracleId}`),
}

export const imageUrl = (id: string, size: 'normal' | 'large' = 'normal', face = 0) =>
  `/api/images/${id}?size=${size}&face=${face}`
