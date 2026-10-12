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
  /** legal | not_legal | restricted | banned, per format */
  legalities: Record<string, string>
  /** tokens, emblems and markers the card makes */
  produces: { id: string; kind: TokenKind; name: string }[]
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
  /** rows of the collection whose card Scryfall did not send yet (an outage during the import) */
  pending_cards: number
  retry: { status: 'idle' | 'running' | 'error'; error: string | null }
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

export type ListKind = 'cube' | 'deck'
export type DeckFormat = 'none' | 'standard' | 'pioneer' | 'modern' | 'legacy' | 'vintage' | 'pauper' | 'premodern' | 'commander'
/** Decks only; cubes keep everything on `main`. The maybeboard is considered, not played. */
export type Board = 'commander' | 'companion' | 'main' | 'side' | 'maybe'
export type RemoteSource = 'cubecobra' | 'moxfield'

export interface ListSummary {
  id: number
  name: string
  description: string
  kind: ListKind
  /** decks only ('none' checks nothing) */
  format: DeckFormat | null
  /** who shared the list, when it was imported from someone else's export */
  shared_by: string | null
  /** the CubeCobra cube or Moxfield deck the list syncs from */
  remote_source: RemoteSource | null
  remote_id: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
  /** copies played (maybeboard excluded) */
  card_count: number
  unique_count: number
}

export type Ownership = 'owned' | 'partial' | 'not_owned'

export interface ListItem {
  id: number
  board: Board
  oracle_id: string
  scryfall_id: string
  quantity: number
  added_at: string
  /** copies the collection has for this item, once the boards before it in the list took theirs */
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
  board: Board
  scryfall_id: string
  quantity: number
  owned: number
  ownership: Ownership
  their_owned: number | null
  tags: string[]
  /** only for CubeCobra cubes */
  cube_statuses: string[] | null
  card: Card
}

export interface ListImportPreview {
  meta: {
    name: string | null
    kind: ListKind | null
    format: DeckFormat | null
    has_ownership: boolean
    /** the CubeCobra cube or Moxfield deck to link the list to */
    remote?: { source: RemoteSource; id: string } | null
  }
  items: ListImportPreviewItem[]
  /** lines that could not be parsed or matched to a card */
  unresolved: string[]
}

interface SyncLine {
  oracle_id: string
  name: string
  board: Board
}

/** Differences between a list and its CubeCobra cube or Moxfield deck (applied when `applied` is true). */
export interface SyncDiff {
  remote: { source: RemoteSource; id: string; name: string; url: string }
  applied: boolean
  added: (SyncLine & { quantity: number; owned: number })[]
  removed: (SyncLine & { quantity: number })[]
  changed: (SyncLine & { from: number; to: number })[]
  /** cards that changed board (`board` is the new one) */
  moved: (SyncLine & { from_board: Board; from: number; to: number })[]
  /** cards that gain tags from the cube (local tags are kept) */
  retagged: (SyncLine & { tags: string[] })[]
  /** cards whose copies marked as in the cube changed; `from` is null when not known yet */
  restatused: (SyncLine & { from: number | null; to: number; quantity: number })[]
  format: { from: DeckFormat | null; to: DeckFormat } | null
  /** custom cards, ids Scryfall does not know or lines not recognised: skipped */
  unresolved: string[]
  /** boards the remote doesn't list (a pasted export without them): left as they are */
  kept_boards: Board[]
  /** cards in the list before the sync */
  list_size: number
}

/** A Moxfield deck as the bookmarklet reads it. */
export interface MoxfieldDeck {
  id: string
  name: string
  format: string | null
  boards: Record<string, { scryfall_id: string | null; name: string; quantity: number; set?: string | null; cn?: string | null }[]>
}

export type TokenKind = 'token' | 'emblem' | 'marker'

export interface ListToken {
  oracle_id: string
  scryfall_id: string
  kind: TokenKind
  card: Card
  /** cards of the list that make it */
  sources: string[]
  quantity: number
  /** the quantity was set by hand */
  custom: boolean
  hidden: boolean
  owned: number
  ownership: Ownership
}
