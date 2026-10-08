import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { fmtNum } from '../lib/cards'
import type { CubeSync } from '../lib/types'
import { useData } from '../store/data'

function Section({ title, tone, children }: { title: string; tone?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className={`m-0 text-[13px] font-semibold ${tone ?? ''}`}>{title}</h3>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  )
}

function Line({ name, detail }: { name: string; detail?: string }) {
  return (
    <li className="flex items-center gap-3 border-t border-chip py-1.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {detail && <span className="font-mono text-xs text-dim">{detail}</span>}
    </li>
  )
}

/**
 * Diff a list against a CubeCobra cube and apply it. With `cubeId` null the user first enters
 * the cube URL: the list gets linked to it when the sync is applied.
 */
export function CubeSyncDialog({ listId, cubeId, onClose }: { listId: number; cubeId: string | null; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [diff, setDiff] = useState<CubeSync | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = useCallback(
    async (cube?: string) => {
      setBusy(true)
      setError(null)
      try {
        setDiff(await api.syncCube(listId, { cube }))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [listId],
  )

  useEffect(() => {
    if (cubeId) void preview()
  }, [cubeId, preview])

  const apply = async () => {
    if (!diff) return
    // Losing most of the list is more likely a problem on CubeCobra's side than a real change.
    if (diff.list_size > 0 && diff.removed.length * 2 > diff.list_size) {
      const ok = window.confirm(`The sync removes ${diff.removed.length} of the ${diff.list_size} cards in the list. Continue?`)
      if (!ok) return
    }
    setBusy(true)
    try {
      await api.syncCube(listId, { cube: diff.cube.id, apply: true })
      await useData.getState().listsChanged()
      toast.success(`Synced with “${diff.cube.name}”`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }

  const empty = diff && !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.retagged.length && !diff.restatused.length
  const missingNew = diff?.added.filter((a) => a.owned < a.quantity).length ?? 0
  // Statuses never read before (lists linked before they were tracked): one summary line, not one per card.
  const restatused = diff?.restatused.filter((r) => r.from != null) ?? []
  const firstStatuses = (diff?.restatused.length ?? 0) - restatused.length

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[560px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[14px] border border-[#3A3F4B] bg-raised p-5 shadow-[0_24px_60px_rgba(0,0,0,.65)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="m-0 text-base font-semibold">{cubeId ? 'Sync with CubeCobra' : 'Link to a CubeCobra cube'}</Dialog.Title>
              <Dialog.Description className="m-0 mt-0.5 text-xs text-dim">
                The cube decides which cards are in the list. Its tags are added to yours; tags removed on CubeCobra stay here.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-2 -mt-2" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>

          {!cubeId && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (url.trim()) void preview(url.trim())
              }}
            >
              <input
                className="field flex-1"
                autoFocus
                aria-label="Cube URL"
                placeholder="https://cubecobra.com/cube/list/…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setDiff(null)
                }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
                Preview
              </button>
            </form>
          )}

          {busy && !diff && <span className="text-xs text-muted">Fetching the cube…</span>}

          {error && !busy && (
            <div role="alert" className="flex items-center gap-3 rounded-xl border border-line-2 bg-panel px-4 py-3 text-sm text-bad">
              <span className="flex-1">{error}</span>
              {cubeId && (
                <button type="button" className="btn" onClick={() => void preview()}>
                  Retry
                </button>
              )}
            </div>
          )}

          {diff && (
            <>
              <a className="flex items-center gap-1.5 self-start text-sm text-accent hover:text-accent-hi" href={diff.cube.url} target="_blank" rel="noreferrer">
                {diff.cube.name} <ExternalLink size={13} />
              </a>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                {empty && <div className="panel px-4 py-6 text-center text-sm text-muted">The list already matches the cube.</div>}
                {diff.added.length > 0 && (
                  <Section title={`To add ${diff.added.length}${missingNew ? ` · ${missingNew} not in your collection` : ''}`} tone="text-ok">
                    {diff.added.map((a) => (
                      <Line key={a.oracle_id} name={a.name} detail={`${Math.min(a.owned, a.quantity)}/${a.quantity} owned`} />
                    ))}
                  </Section>
                )}
                {diff.removed.length > 0 && (
                  <Section title={`To remove ${diff.removed.length}`} tone="text-bad">
                    {diff.removed.map((r) => (
                      <Line key={r.oracle_id} name={r.name} detail={`×${r.quantity}`} />
                    ))}
                  </Section>
                )}
                {diff.changed.length > 0 && (
                  <Section title={`Copies changed ${diff.changed.length}`}>
                    {diff.changed.map((c) => (
                      <Line key={c.oracle_id} name={c.name} detail={`${c.from} → ${c.to}`} />
                    ))}
                  </Section>
                )}
                {diff.retagged.length > 0 && (
                  <Section title={`New tags on ${diff.retagged.length} cards`}>
                    {diff.retagged.map((r) => (
                      <Line key={r.oracle_id} name={r.name} detail={r.tags.join(', ')} />
                    ))}
                  </Section>
                )}
                {restatused.length > 0 && (
                  <Section title={`Owned on CubeCobra changed for ${restatused.length} cards`}>
                    {restatused.map((r) => (
                      <Line key={r.oracle_id} name={r.name} detail={`${r.from} → ${r.to}/${r.quantity}`} />
                    ))}
                  </Section>
                )}
                {firstStatuses > 0 && (
                  <div className="panel px-4 py-3 text-[13px] text-muted">
                    Reads what CubeCobra marks as owned for {fmtNum(firstStatuses)} cards, for the <strong className="text-fg">Compare</strong> tab.
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
                <button type="button" className="btn btn-primary" disabled={busy || (!!empty && !!cubeId)} onClick={() => void apply()}>
                  {cubeId ? 'Apply' : 'Link and apply'}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
