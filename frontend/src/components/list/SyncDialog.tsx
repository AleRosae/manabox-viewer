import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type MoxfieldSource } from '../../lib/api'
import { fmtNum } from '../../lib/cards'
import { FORMATS } from '../../lib/legality'
import { BOARD_LABEL } from '../../lib/listGroups'
import { parseDeckJson } from '../../lib/moxfield'
import type { Board, ListDetail, MoxfieldDeck, SyncDiff } from '../../lib/types'
import { useData } from '../../store/data'
import { MoxfieldBookmarklet } from './MoxfieldBookmarklet'

function Section({ title, tone, children }: { title: string; tone?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className={`m-0 text-[13px] font-semibold ${tone ?? ''}`}>{title}</h3>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  )
}

function Line({ name, detail, board }: { name: string; detail?: string; board?: Board }) {
  return (
    <li className="flex items-center gap-3 border-t border-chip py-1.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {board && board !== 'main' && <span className="text-xs text-dim">{BOARD_LABEL[board]}</span>}
      {detail && <span className="font-mono text-xs text-dim">{detail}</span>}
    </li>
  )
}

const SERVICE = { cube: 'CubeCobra', deck: 'Moxfield' } as const

/**
 * Diff a cube against its CubeCobra cube, or a deck against its Moxfield version, then apply it.
 *
 * Cubes are read from CubeCobra; decks from what the user brings (Moxfield blocks our server): the
 * bookmarklet's `payload`, or the deck text exported from Moxfield. An unlinked list first asks
 * for the URL, and gets linked to it when the sync is applied.
 */
export function SyncDialog({ list, payload, onClose }: { list: ListDetail; payload?: MoxfieldDeck; onClose: () => void }) {
  const deck = list.kind === 'deck'
  const service = SERVICE[list.kind]
  const linked = list.remote_source === (deck ? 'moxfield' : 'cubecobra')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [diff, setDiff] = useState<SyncDiff | null>(null)
  const [source, setSource] = useState<MoxfieldSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (src: MoxfieldSource & { cube?: string }) => {
      setBusy(true)
      setError(null)
      try {
        setDiff(deck ? await api.syncDeck(list.id, src) : await api.syncCube(list.id, { cube: src.cube }))
        setSource(src)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [deck, list.id],
  )

  useEffect(() => {
    if (payload) void run({ payload })
    else if (linked && !deck) void run({})
  }, [payload, linked, deck, run])

  const preview = () => {
    if (!deck) return void run({ cube: url.trim() || undefined })
    const json = parseDeckJson(text)
    void run(json ? { payload: json } : { text, deck: url.trim() || undefined })
  }

  const apply = async () => {
    if (!diff || !source) return
    // Losing most of the list is more likely a problem on the other side than a real change.
    if (diff.list_size > 0 && diff.removed.length * 2 > diff.list_size) {
      const ok = window.confirm(`The sync removes ${diff.removed.length} of the ${diff.list_size} cards in the list. Continue?`)
      if (!ok) return
    }
    setBusy(true)
    try {
      if (deck) await api.syncDeck(list.id, { ...source, deck: source.payload ? undefined : diff.remote.id, apply: true })
      else await api.syncCube(list.id, { cube: diff.remote.id, apply: true })
      await useData.getState().listsChanged()
      toast.success(`Synced with “${diff.remote.name}”`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }

  const empty =
    diff && !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.moved.length && !diff.retagged.length && !diff.restatused.length && !diff.format
  const missingNew = diff?.added.filter((a) => a.owned < a.quantity).length ?? 0
  // Statuses never read before (cubes linked before they were tracked): one summary line, not one per card.
  const restatused = diff?.restatused.filter((r) => r.from != null) ?? []
  const firstStatuses = (diff?.restatused.length ?? 0) - restatused.length
  const needsInput = deck ? !payload : !linked

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[580px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[14px] border border-[#3A3F4B] bg-raised p-5 shadow-[0_24px_60px_rgba(0,0,0,.65)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 text-base font-semibold">{linked ? `Sync with ${service}` : `Link to ${service}`}</Dialog.Title>
              <Dialog.Description className="m-0 mt-0.5 text-xs text-dim">
                {deck
                  ? 'Moxfield decides the cards and their boards. Boards missing from a pasted export stay as they are here; your printings are kept.'
                  : 'The cube decides which cards are in the list. Its tags are added to yours; tags removed on CubeCobra stay here.'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-2 -mt-2" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>

          {needsInput && !diff && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                preview()
              }}
            >
              {!linked && (
                <input
                  className="field"
                  autoFocus
                  aria-label={`${service} URL`}
                  placeholder={deck ? 'https://moxfield.com/decks/…' : 'https://cubecobra.com/cube/list/…'}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              )}
              {deck && (
                <>
                  <textarea
                    className="field min-h-36 resize-y py-2 font-mono text-[12.5px]"
                    autoFocus={linked}
                    aria-label="Deck exported from Moxfield"
                    placeholder={'Paste the deck: on Moxfield, More → Export → Copy for Moxfield\n\n1 Sol Ring (CMM) 400\n…'}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <span className="text-xs text-dim">
                    Or skip the copy-paste: drag <MoxfieldBookmarklet /> to your bookmarks bar and click it on the deck's page.
                  </span>
                </>
              )}
              <button type="submit" className="btn btn-primary self-end" disabled={busy || (deck ? !text.trim() || (!linked && !url.trim() && !parseDeckJson(text)) : !url.trim())}>
                Preview
              </button>
            </form>
          )}

          {busy && !diff && <span className="text-xs text-muted">{deck ? 'Looking up cards…' : 'Fetching the cube…'}</span>}

          {error && !busy && (
            <div role="alert" className="flex items-center gap-3 rounded-xl border border-line-2 bg-panel px-4 py-3 text-sm text-bad">
              <span className="flex-1">{error}</span>
              {linked && !deck && (
                <button type="button" className="btn" onClick={() => void run({})}>
                  Retry
                </button>
              )}
            </div>
          )}

          {diff && (
            <>
              <a className="flex items-center gap-1.5 self-start text-sm text-accent hover:text-accent-hi" href={diff.remote.url} target="_blank" rel="noreferrer">
                {diff.remote.name} <ExternalLink size={13} />
              </a>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                {empty && <div className="panel px-4 py-6 text-center text-sm text-muted">The list already matches {service}.</div>}
                {diff.format && (
                  <div className="panel px-4 py-3 text-[13px] text-muted">
                    Format: {diff.format.from ? FORMATS[diff.format.from].label : 'none'} → <strong className="text-fg">{FORMATS[diff.format.to].label}</strong>
                  </div>
                )}
                {diff.added.length > 0 && (
                  <Section title={`To add ${diff.added.length}${missingNew ? ` · ${missingNew} not in your collection` : ''}`} tone="text-ok">
                    {diff.added.map((a) => (
                      <Line key={a.board + a.oracle_id} name={a.name} board={a.board} detail={`${Math.min(a.owned, a.quantity)}/${a.quantity} owned`} />
                    ))}
                  </Section>
                )}
                {diff.removed.length > 0 && (
                  <Section title={`To remove ${diff.removed.length}`} tone="text-bad">
                    {diff.removed.map((r) => (
                      <Line key={r.board + r.oracle_id} name={r.name} board={r.board} detail={`×${r.quantity}`} />
                    ))}
                  </Section>
                )}
                {diff.changed.length > 0 && (
                  <Section title={`Copies changed ${diff.changed.length}`}>
                    {diff.changed.map((c) => (
                      <Line key={c.board + c.oracle_id} name={c.name} board={c.board} detail={`${c.from} → ${c.to}`} />
                    ))}
                  </Section>
                )}
                {diff.moved.length > 0 && (
                  <Section title={`Moved to another board ${diff.moved.length}`}>
                    {diff.moved.map((m) => (
                      <Line key={m.board + m.oracle_id} name={m.name} detail={`${BOARD_LABEL[m.from_board]} → ${BOARD_LABEL[m.board]}${m.from !== m.to ? ` · ${m.from} → ${m.to}` : ''}`} />
                    ))}
                  </Section>
                )}
                {diff.retagged.length > 0 && (
                  <Section title={`New tags on ${diff.retagged.length} cards`}>
                    {diff.retagged.map((r) => (
                      <Line key={r.board + r.oracle_id} name={r.name} detail={r.tags.join(', ')} />
                    ))}
                  </Section>
                )}
                {restatused.length > 0 && (
                  <Section title={`Owned on CubeCobra changed for ${restatused.length} cards`}>
                    {restatused.map((r) => (
                      <Line key={r.board + r.oracle_id} name={r.name} detail={`${r.from} → ${r.to}/${r.quantity}`} />
                    ))}
                  </Section>
                )}
                {firstStatuses > 0 && (
                  <div className="panel px-4 py-3 text-[13px] text-muted">
                    Reads what CubeCobra marks as owned for {fmtNum(firstStatuses)} cards, for the <strong className="text-fg">Compare</strong> tab.
                  </div>
                )}
                {diff.kept_boards.length > 0 && (
                  <div className="panel px-4 py-3 text-[13px] text-muted">
                    Not in the export, left as they are: {diff.kept_boards.map((b) => BOARD_LABEL[b]).join(', ')}.
                  </div>
                )}
                {diff.unresolved.length > 0 && (
                  <Section title={`Skipped ${diff.unresolved.length} (custom or unknown cards)`} tone="text-dim">
                    {diff.unresolved.map((n, i) => (
                      <Line key={i} name={n} />
                    ))}
                  </Section>
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <span className="mr-auto text-xs text-dim">
                  {fmtNum(diff.added.length)} added · {fmtNum(diff.removed.length)} removed
                </span>
                <button type="button" className="btn" disabled={busy} onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || (!!empty && linked)} onClick={() => void apply()}>
                  {linked ? 'Apply' : 'Link and apply'}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
