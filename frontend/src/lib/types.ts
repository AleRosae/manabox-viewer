export type Finish = 'normal' | 'foil' | 'etched'

export interface Face {
  name: string
  mana_cost: string
  type_line: string
  oracle_text: string
  colors: string[] | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  has_image: boolean
}

export type PriceKey = 'eur' | 'eur_foil' | 'eur_etched' | 'usd' | 'usd_foil' | 'usd_etched'

export interface Card {
  id: string
  oracle_id: string
  name: string
  lang: string
  layout: string
  mana_cost: string
  cmc: number
  type_line: string
  oracle_text: string
  colors: string[]
  color_identity: string[]
  keywords: string[]
  power: string | null
  toughness: string | null
  loyalty: string | null
  rarity: string
  set: string
  set_name: string
  collector_number: string
  released_at: string | null
  artist: string | null
  legal: string[]
  games: string[]
  faces: Face[]
  image_faces: 1 | 2
  prices: Record<PriceKey, string | null>
  scryfall_uri: string | null
}

export interface Row {
  id: number
  binder_name: string
  name: string
  set_code: string
  collector_number: string
  finish: Finish
  rarity: string | null
  quantity: number
  scryfall_id: string | null
  purchase_price: number | null
  currency: string | null
  condition: string | null
  language: string | null
  signed: number
  altered: number
  misprint: number
  proxy: number
  added_at: string | null
}

export interface ImportInfo {
  id: number
  filename: string
  imported_at: string
  row_count: number
  total_quantity: number
  status: 'enriching' | 'ready' | 'error'
  progress: number
  error: string | null
}

export interface PriceJob {
  status: 'idle' | 'running' | 'error'
  progress: number
  updated_at: string | null
  error: string | null
}

export interface Status {
  current_import: ImportInfo | null
  pending_import: ImportInfo | null
  usd_to_eur: number
  prices: PriceJob
}

export interface CollectionData {
  import: ImportInfo | null
  rows: Row[]
  cards: Record<string, Card>
}

export interface DiffLine {
  name: string
  set_code: string
  collector_number: string
  binder: string
  finish: Finish
  scryfall_id: string | null
  quantity: number
  before?: number
  after?: number
}

export interface ImportDiff {
  previous_import_id: number
  added: DiffLine[]
  removed: DiffLine[]
  changed: DiffLine[]
  summary: { added_copies: number; removed_copies: number }
}

export type ListKind = 'cube' | 'generic'

export interface ListSummary {
  id: number
  name: string
  description: string
  kind: ListKind
  /** who shared the list, when it was imported from someone else's export */
  shared_by: string | null
  /** linked CubeCobra cube id; synced on demand */
  cubecobra_id: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
  card_count: number
  unique_count: number
}

export type Ownership = 'owned' | 'partial' | 'not_owned'

export interface ListItem {
  id: number
  oracle_id: string
  scryfall_id: string
  quantity: number
  added_at: string
  owned: number
  used_elsewhere: number
  ownership: Ownership
  /** copies the sharer owned (imported lists only); null when unknown */
  their_owned: number | null
  /** labels, exported as CubeCobra tags */
  tags: string[]
  /** CubeCobra status of each copy (Owned, Proxied, ...), as of the last sync; null when unknown */
  cube_statuses: string[] | null
  /** copies CubeCobra marks as in the cube (owned, proxied, borrowed); null when unknown */
  cube_owned: number | null
  card: Card
}

export interface ListDetail extends ListSummary {
  items: ListItem[]
}

/** {oracle_id: {list_id: quantity}} */
export type Usage = Record<string, Record<string, number>>

/** One display unit: a CSV row (binder scope) or all copies of a card (all-binders scope). */
export interface Entry {
  key: string
  card: Card
  rows: Row[]
  quantity: number
  binders: string[]
  foil: boolean
  unitMarket: number | null
  unitPurchase: number | null
  marketValue: number
  purchaseValue: number
  addedAt: string | null
}

export interface ListImportPreviewItem {
  oracle_id: string
  scryfall_id: string
  quantity: number
  owned: number
  ownership: Ownership
  their_owned: number | null
  tags: string[]
  /** only for CubeCobra cubes */
  cube_statuses?: string[]
  card: Card
}

export interface ListImportPreview {
  meta: { name: string | null; kind: ListKind | null; has_ownership: boolean; cubecobra_id?: string }
  items: ListImportPreviewItem[]
  /** lines that could not be parsed or matched to a card */
  unresolved: string[]
}

/** Differences between a list and its CubeCobra cube (applied when `applied` is true). */
export interface CubeSync {
  cube: { id: string; name: string; url: string }
  applied: boolean
  added: { oracle_id: string; name: string; quantity: number; owned: number }[]
  removed: { oracle_id: string; name: string; quantity: number }[]
  changed: { oracle_id: string; name: string; from: number; to: number }[]
  /** cards that gain tags from the cube (local tags are kept) */
  retagged: { oracle_id: string; name: string; tags: string[] }[]
  /** cards whose copies marked as in the cube changed; `from` is null when not known yet */
  restatused: { oracle_id: string; name: string; from: number | null; to: number; quantity: number }[]
  /** custom cards or ids Scryfall does not know: skipped */
  unresolved: string[]
  /** cards in the list before the sync */
  list_size: number
}
