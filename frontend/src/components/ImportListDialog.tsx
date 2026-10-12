import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { FileUp, Link2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { fmtEur, fmtNum, marketPrice } from '../lib/cards'
import { compareSummary } from '../lib/compare'
import { FORMAT_ORDER, FORMATS } from '../lib/legality'
import { BOARD_LABEL } from '../lib/listGroups'
import { parseDeckJson } from '../lib/moxfield'
import { listPath } from '../lib/paths'
import type { DeckFormat, ListImportPreview, ListImportPreviewItem, ListKind, MoxfieldDeck } from '../lib/types'
import { useData, useUsdRate } from '../store/data'
import { useHoverPreview } from './HoverPreview'
import { MoxfieldBookmarklet } from './list/MoxfieldBookmarklet'

function MissingRow({ item }: { item: ListImportPreviewItem }) {
  const hover = useHoverPreview(item.card, item.ownership === 'not_owned')
  return (
    <li className="flex items-center gap-3 border-t border-chip py-1.5 text-[13px]" {...hover}>
      <span className="min-w-0 flex-1 truncate">{item.card.name}</span>
      {item.board !== 'main' && <span className="text-xs text-dim">{BOARD_LABEL[item.board]}</span>}
      <span className="font-mono text-xs text-dim">
        {item.owned}/{item.quantity}
      </span>
    </li>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-line-2 bg-panel px-3 py-2">
      <span className="text-[11px] text-dim">{label}</span>
      <span className={clsx('font-mono text-[15px]', tone)}>{value}</span>
    </div>
  )
}

const baseName = (filename: string) => filename.replace(/(\.mbv)?\.txt$/i, '').replace(/[_-]+/g, ' ').trim()

/**
 * Import a cube (from CubeCobra or text) or a deck (from Moxfield or text): preview the diff with
 * the collection, then create it. `moxfield` is a deck the bookmarklet sent.
 */
export function ImportListDialog({ kind, moxfield, onClose }: { kind: ListKind; moxfield?: MoxfieldDeck; onClose: () => void }) {
  const navigate = useNavigate()
  const rate = useUsdRate()
  const [text, setText] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [preview, setPreview] = useState<ListImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [format, setFormat] = useState<DeckFormat>('none')
  const [sharedBy, setSharedBy] = useState('')
  // CubeCobra cube for cubes; for decks, the Moxfield deck the pasted export comes from
  const [remoteUrl, setRemoteUrl] = useState('')
  const deck = kind === 'deck'

  const show = (p: ListImportPreview, fallbackName: string) => {
    if (!p.items.length) {
      toast.error('No cards recognised')
      return
    }
    setPreview(p)
    setName(p.meta.name ?? fallbackName)
    setFormat(p.meta.format ?? 'none')
  }

  const load = async (fetchPreview: () => Promise<ListImportPreview>, fallbackName: string) => {
    setBusy(true)
    try {
      show(await fetchPreview(), fallbackName)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runPreview = (source: string, file: string | null) => {
    if (!source.trim()) return
    const fallback = file ? baseName(file) : deck ? 'Imported deck' : 'Imported cube'
    const json = deck ? parseDeckJson(source) : null
    if (json) void load(() => api.previewMoxfield({ payload: json }), json.name)
    else if (deck && remoteUrl.trim()) void load(() => api.previewMoxfield({ text: source, deck: remoteUrl.trim() }), fallback)
    else void load(() => api.previewListImport(source), fallback)
  }

  const runCubePreview = () => {
    if (!remoteUrl.trim()) return
    setFilename(null)
    void load(() => api.previewCube(remoteUrl.trim()), 'CubeCobra cube')
  }

  useEffect(() => {
    if (moxfield) void load(() => api.previewMoxfield({ payload: moxfield }), moxfield.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the deck the dialog opened with
  }, [moxfield])

  const readFile = async (file: File) => {
    const content = await file.text()
    setText(content)
    setFilename(file.name)
    runPreview(content, file.name)
  }

  const items = useMemo(() => preview?.items ?? [], [preview])
  const summary = useMemo(() => compareSummary(items, (i) => marketPrice(i.card, 'normal', rate) ?? 0), [items, rate])
  const missing = items.filter((i) => i.owned < i.quantity)
  const copies = items.reduce((n, i) => n + i.quantity, 0)
  const counts = {
    owned: items.filter((i) => i.ownership === 'owned').length,
    partial: items.filter((i) => i.ownership === 'partial').length,
    not_owned: items.filter((i) => i.ownership === 'not_owned').length,
  }

  const create = async () => {
    if (!preview || !name.trim()) return
    setBusy(true)
    try {
      const list = await api.importList({
        name: name.trim(),
        kind,
        format: deck ? format : null,
        shared_by: preview.meta.has_ownership ? sharedBy.trim() || null : null,
        remote_source: preview.meta.remote?.source ?? null,
        remote_id: preview.meta.remote?.id ?? null,
        items: items.map((i) => ({
          scryfall_id: i.scryfall_id,
          quantity: i.quantity,
          board: deck ? i.board : 'main',
          their_owned: i.their_owned,
          tags: i.tags,
          cube_statuses: i.cube_statuses,
        })),
      })
      await useData.getState().listsChanged()
      toast.success(`Imported “${list.name}”: ${fmtNum(copies)} cards`)
      onClose()
      navigate(listPath(list))
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[600px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[14px] border border-[#3A3F4B] bg-raised p-5 shadow-[0_24px_60px_rgba(0,0,0,.65)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 text-base font-semibold">Import {deck ? 'deck' : 'cube'}</Dialog.Title>
              <Dialog.Description className="m-0 mt-0.5 text-xs text-dim">
                {preview
                  ? `${fmtNum(items.length)} cards · ${fmtNum(copies)} copies${filename ? ` · ${filename}` : ''}${preview.meta.remote ? ` · linked to ${preview.meta.remote.source === 'moxfield' ? 'Moxfield' : 'CubeCobra'}, sync it any time` : ''}`
                  : deck
                    ? 'A deck exported from Moxfield (or Arena, MTGO...), a ManaBox Viewer share file (.mbv.txt) or plain “1 Name (SET) 123” lines'
                    : 'A CubeCobra cube, a ManaBox Viewer share file (.mbv.txt) or plain “1 Name (SET) 123” lines'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-2 -mt-2" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>

          {!preview ? (
            <>
              {deck ? (
                <>
                  <span className="flex items-center gap-2 rounded-[9px] border border-line bg-panel-2 pl-3">
                    <Link2 size={15} className="shrink-0 text-accent" />
                    <input
                      className="min-h-9 flex-1 bg-transparent text-sm outline-none"
                      aria-label="Moxfield deck URL"
                      placeholder="Moxfield deck URL, to sync it later (optional)"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                    />
                  </span>
                  <span className="text-xs text-dim">
                    On Moxfield: More → Export → Copy for Moxfield, then paste it below. Or click <MoxfieldBookmarklet /> on the deck's page, once it is in your bookmarks.
                  </span>
                </>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    runCubePreview()
                  }}
                >
                  <span className="flex flex-1 items-center gap-2 rounded-[9px] border border-line bg-panel-2 pl-3">
                    <Link2 size={15} className="shrink-0 text-accent" />
                    <input
                      className="min-h-9 flex-1 bg-transparent text-sm outline-none"
                      aria-label="CubeCobra cube URL"
                      placeholder="CubeCobra cube URL, e.g. https://cubecobra.com/cube/list/…"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                    />
                  </span>
                  <button type="submit" className="btn" disabled={busy || !remoteUrl.trim()}>
                    Load cube
                  </button>
                </form>
              )}
              <label
                className={clsx(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-3 bg-panel px-6 py-8 text-center hover:border-dim',
                  busy && 'pointer-events-none opacity-60',
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) void readFile(file)
                }}
              >
                <FileUp size={26} className="text-accent" />
                <span className="text-sm font-semibold">Drop a .txt file here</span>
                <span className="text-xs text-muted">or click to choose it</span>
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void readFile(file)
                    e.target.value = ''
                  }}
                />
              </label>
              <textarea
                className="field min-h-36 resize-y py-2 font-mono text-[12.5px]"
                placeholder={'…or paste it here\n\n1 Lightning Bolt (2X2) 117\n2 Counterspell'}
                aria-label="List text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setFilename(null)
                }}
              />
              <div className="flex items-center justify-end gap-3">
                {busy && <span className="text-xs text-muted">Looking up cards…</span>}
                <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => runPreview(text, filename)}>
                  Preview
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className="field" aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                {deck ? (
                  <select className="field" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as DeckFormat)}>
                    {FORMAT_ORDER.map((f) => (
                      <option key={f} value={f}>
                        {FORMATS[f].label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span />
                )}
                {preview.meta.has_ownership && (
                  <input
                    className="field col-span-2"
                    aria-label="Shared by"
                    placeholder="Shared by (e.g. Marco), used to label their copies"
                    value={sharedBy}
                    onChange={(e) => setSharedBy(e.target.value)}
                  />
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                <section className="flex flex-col gap-2">
                  <h3 className="m-0 text-[13px] font-semibold">Against your collection</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Owned" value={fmtNum(counts.owned)} tone="text-ok" />
                    <Stat label="Partial" value={fmtNum(counts.partial)} tone="text-accent" />
                    <Stat label="Not owned" value={fmtNum(counts.not_owned)} tone="text-bad" />
                    <Stat label="To complete" value={fmtEur(summary.youMissValue)} />
                  </div>
                </section>

                {preview.meta.has_ownership && (
                  <section className="flex flex-col gap-2">
                    <h3 className="m-0 text-[13px] font-semibold">You vs {sharedBy.trim() || 'them'}</h3>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat label="Both have" value={fmtNum(summary.counts.both)} />
                      <Stat label="Only you" value={fmtNum(summary.counts.only_me)} />
                      <Stat label={`Only ${sharedBy.trim() || 'them'}`} value={fmtNum(summary.counts.only_them)} />
                      <Stat label="Neither" value={fmtNum(summary.counts.neither)} />
                    </div>
                  </section>
                )}

                {missing.length > 0 && (
                  <section className="flex flex-col gap-1">
                    <h3 className="m-0 text-[13px] font-semibold">
                      You're missing <span className="font-mono text-dim">{missing.length}</span>
                    </h3>
                    <ul className="m-0 list-none p-0">
                      {missing.slice(0, 200).map((i) => (
                        <MissingRow key={i.board + i.oracle_id} item={i} />
                      ))}
                    </ul>
                    {missing.length > 200 && <span className="text-xs text-dim">…and {missing.length - 200} more</span>}
                  </section>
                )}

                {preview.unresolved.length > 0 && (
                  <section className="flex flex-col gap-1">
                    <h3 className="m-0 text-[13px] font-semibold text-bad">
                      Not recognised <span className="font-mono">{preview.unresolved.length}</span>
                    </h3>
                    <span className="text-xs text-dim">These lines will be skipped.</span>
                    <ul className="m-0 list-none p-0 font-mono text-xs text-muted">
                      {preview.unresolved.map((l, n) => (
                        <li key={n} className="truncate border-t border-chip py-1">
                          {l}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" className="btn" disabled={busy} onClick={() => setPreview(null)}>
                  Back
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
                  Create {deck ? 'deck' : 'cube'}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
