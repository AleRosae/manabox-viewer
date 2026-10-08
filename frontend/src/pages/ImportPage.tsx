import clsx from 'clsx'
import { CheckCircle2, FileUp, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { fmtDate, fmtNum } from '../lib/cards'
import type { DiffLine, ImportDiff, ImportInfo } from '../lib/types'
import { useData } from '../store/data'

function DiffList({ title, lines, tone }: { title: string; lines: DiffLine[]; tone: 'add' | 'remove' | 'change' }) {
  const [all, setAll] = useState(false)
  if (!lines.length) return null
  const shown = all ? lines : lines.slice(0, 12)
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-semibold">
        {title} <span className="font-mono text-dim">{lines.length}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col p-0 text-[13px]">
        {shown.map((l, i) => (
          <li key={i} className="flex items-center gap-3 border-t border-line py-1.5">
            <span className={clsx('w-12 font-mono', tone === 'add' ? 'text-ok' : tone === 'remove' ? 'text-bad' : 'text-accent')}>
              {tone === 'change' ? `${l.before}→${l.after}` : `${tone === 'add' ? '+' : '−'}${l.quantity}`}
            </span>
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="font-mono text-xs text-dim">
              {l.set_code} #{l.collector_number}
            </span>
            <span className="hidden w-28 truncate text-right text-xs text-muted sm:inline">{l.binder}</span>
          </li>
        ))}
      </ul>
      {lines.length > 12 && (
        <button type="button" className="self-start text-xs text-accent hover:text-accent-hi" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all (${lines.length})`}
        </button>
      )}
    </section>
  )
}

export function DiffSummary({ diff }: { diff: ImportDiff }) {
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length
  return (
    <div className="panel flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">Changes since the previous import</h2>
        {!empty && (
          <span className="font-mono text-sm">
            <span className="text-ok">+{fmtNum(diff.summary.added_copies)}</span> / <span className="text-bad">−{fmtNum(diff.summary.removed_copies)}</span> copies
          </span>
        )}
      </div>
      {empty ? (
        <p className="m-0 text-sm text-muted">No changes: the collection is identical.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-6">
          <DiffList title="Added" lines={diff.added} tone="add" />
          <DiffList title="Removed" lines={diff.removed} tone="remove" />
          <DiffList title="Quantity changed" lines={diff.changed} tone="change" />
        </div>
      )}
    </div>
  )
}

export function ImportPage() {
  const navigate = useNavigate()
  const status = useData((s) => s.status)
  const { loadStatus, loadCollection, listsChanged } = useData.getState()
  const [job, setJob] = useState<ImportInfo | null>(null)
  const [diff, setDiff] = useState<ImportDiff | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const current = status?.current_import ?? null

  const poll = useCallback(
    async (id: number) => {
      for (;;) {
        const info = await api.getImport(id)
        setJob(info)
        if (info.status !== 'enriching') {
          await loadStatus()
          if (info.status === 'ready') {
            await loadCollection()
            await listsChanged()
            setDiff(await api.importDiff(id))
            toast.success(`Import complete: ${fmtNum(info.total_quantity)} ${info.total_quantity === 1 ? 'copy' : 'copies'}`)
          }
          return
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
    },
    [loadStatus, loadCollection, listsChanged],
  )

  // Resume an import that is still running (e.g. after a page reload) and show the last diff.
  useEffect(() => {
    if (status?.pending_import?.status === 'enriching' && !job) void poll(status.pending_import.id)
    else if (status?.pending_import?.status === 'error' && !job) setJob(status.pending_import)
    if (current && !diff && !job) api.importDiff(current.id).then(setDiff, () => {})
  }, [])

  const upload = async (file: File) => {
    setUploading(true)
    setDiff(null)
    try {
      const { id } = await api.uploadImport(file)
      await poll(id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const running = job?.status === 'enriching' || uploading
  const prices = status?.prices

  const refreshPrices = async () => {
    try {
      await api.refreshPrices()
      for (;;) {
        const s = await loadStatus()
        if (s.prices.status !== 'running') break
        await new Promise((r) => setTimeout(r, 1000))
      }
      await loadCollection()
      await listsChanged()
      toast.success('Prices updated')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-4 pb-14 pt-8 sm:px-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em]">{current ? 'Import a new export' : 'Welcome to ManaBox Viewer'}</h1>
        <p className="m-0 text-sm text-muted">
          In ManaBox: <em>Collection → menu → Export → CSV</em>. The file is enriched with Scryfall data (text, colors, prices, images); lists stay linked to their cards across new imports.
        </p>
      </div>

      <label
        className={clsx(
          'flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors',
          dragging ? 'border-accent bg-warn-bg' : 'border-line-3 bg-panel hover:border-dim',
          running && 'pointer-events-none opacity-60',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void upload(file)
        }}
      >
        <FileUp size={34} className="text-accent" />
        <span className="text-base font-semibold">Drop your ManaBox CSV here</span>
        <span className="text-sm text-muted">or click to choose it</span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
      </label>

      {job && (
        <div className="panel flex flex-col gap-3 px-6 py-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{job.filename}</span>
            <span className="font-mono text-xs text-muted">
              {fmtNum(job.row_count)} {job.row_count === 1 ? 'row' : 'rows'} · {fmtNum(job.total_quantity)} {job.total_quantity === 1 ? 'copy' : 'copies'}
            </span>
          </div>
          {job.status === 'enriching' && (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-[#1D2028]">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
              </div>
              <span className="text-xs text-muted">Downloading card data from Scryfall… {Math.round(job.progress * 100)}%</span>
            </>
          )}
          {job.status === 'ready' && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm text-ok">
                <CheckCircle2 size={17} /> Import complete
              </span>
              <button type="button" className="btn btn-primary ml-auto" onClick={() => navigate('/')}>
                Go to collection
              </button>
            </div>
          )}
          {job.status === 'error' && <span className="text-sm text-bad">Import failed: {job.error}</span>}
        </div>
      )}

      {diff && <DiffSummary diff={diff} />}

      {current && (
        <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
          <div className="flex flex-col gap-0.5">
            <span className="facet">Current collection</span>
            <span className="text-sm">
              {current.filename} · imported {fmtDate(current.imported_at)} · {fmtNum(current.total_quantity)} {current.total_quantity === 1 ? 'copy' : 'copies'}
            </span>
            <span className="text-xs text-dim">
              Prices updated {fmtDate(prices?.updated_at ?? current.imported_at)}
              {prices?.status === 'error' && ` · last update failed: ${prices.error}`}
            </span>
          </div>
          <button type="button" className="btn ml-auto" disabled={prices?.status === 'running'} onClick={() => void refreshPrices()}>
            <RefreshCw size={15} className={prices?.status === 'running' ? 'animate-spin' : ''} />
            {prices?.status === 'running' ? `Updating… ${Math.round(prices.progress * 100)}%` : 'Update prices'}
          </button>
        </div>
      )}
    </main>
  )
}
