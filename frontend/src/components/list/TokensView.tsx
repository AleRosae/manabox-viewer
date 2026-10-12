import clsx from 'clsx'
import { Download, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import type { ListToken, TokenKind } from '../../lib/types'
import { useData } from '../../store/data'
import { CardImage } from '../CardImage'
import { useHoverPreview } from '../HoverPreview'
import { QtyStepper } from '../QtyStepper'

const KIND_LABEL: Record<TokenKind, string> = { token: 'Tokens', emblem: 'Emblems', marker: 'Markers and dungeons' }
const KINDS: TokenKind[] = ['token', 'emblem', 'marker']

function TokenTile({ token, onChange }: { token: ListToken; onChange: (t: ListToken, patch: { quantity: number | null; hidden: boolean }) => void }) {
  const notOwned = token.ownership === 'not_owned'
  const hover = useHoverPreview(token.card, notOwned)
  return (
    <div className="group flex flex-col gap-1.5">
      <div className="relative" {...hover}>
        <CardImage card={token.card} dimmed={notOwned || token.hidden} />
        {token.owned > 0 && (
          <span className="absolute left-2 top-2 rounded-md bg-[#1F3A2A] px-1.5 py-px font-mono text-[11px] text-[#8FDCA9]" title="Copies in your collection">
            {token.owned} owned
          </span>
        )}
        <div className="absolute inset-x-2 bottom-2 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label={token.hidden ? `Show ${token.card.name}` : `Hide ${token.card.name}`}
            title={token.hidden ? 'Show it again' : 'Not needed: hide it and leave it out of the exports'}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg/90 hover:bg-chip"
            onClick={() => onChange(token, { quantity: token.custom ? token.quantity : null, hidden: !token.hidden })}
          >
            {token.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {token.custom && (
            <button
              type="button"
              aria-label="Back to the default quantity"
              title="Back to the default quantity"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg/90 hover:bg-chip"
              onClick={() => onChange(token, { quantity: null, hidden: token.hidden })}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>
      <span className="truncate px-0.5 text-[12px]">{token.card.name}</span>
      <span className="truncate px-0.5 text-[11px] text-dim" title={token.sources.join(', ')}>
        from {token.sources.join(', ')}
      </span>
      {!token.hidden && (
        <QtyStepper size="sm" label={`copies of ${token.card.name}`} value={token.quantity} min={0} of={token.owned || undefined} onChange={(q) => onChange(token, { quantity: q, hidden: false })} />
      )}
    </div>
  )
}

/** Tokens, emblems and markers the list's cards make, with the copies needed and owned. */
export function TokensView({ listId }: { listId: number }) {
  const version = useData((s) => s.listsVersion)
  const [tokens, setTokens] = useState<ListToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.tokens(listId).then(
      (t) => {
        setTokens(t)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [listId])
  useEffect(load, [load, version])

  const change = async (token: ListToken, patch: { quantity: number | null; hidden: boolean }) => {
    try {
      await api.updateToken(listId, token.oracle_id, patch)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (error) return <div className="panel p-6 text-sm text-bad">Could not load the tokens: {error}</div>
  if (!tokens) return <div className="h-40 animate-pulse rounded-xl bg-panel" />
  if (!tokens.length)
    return <div className="panel px-6 py-14 text-center text-sm text-muted">No card in the list makes tokens, emblems or markers.</div>

  const shown = tokens.filter((t) => !t.hidden)
  const hidden = tokens.filter((t) => t.hidden)
  const needed = shown.reduce((n, t) => n + t.quantity, 0)
  const missing = shown.reduce((n, t) => n + Math.max(0, t.quantity - t.owned), 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>
          <span className="font-mono text-fg">{needed}</span> needed · <span className="font-mono text-fg">{missing}</span> not owned
        </span>
        <span className="flex-1" />
        <a className="btn" href={api.exportUrl(listId, 'tokens')} download>
          <Download size={15} /> Tokens .txt
        </a>
        <a className={clsx('btn', missing === 0 && 'pointer-events-none opacity-45')} href={api.exportUrl(listId, 'tokens_missing')} download aria-disabled={missing === 0}>
          <Download size={15} /> Missing .txt
        </a>
      </div>
      {KINDS.map((kind) => {
        const group = shown.filter((t) => t.kind === kind)
        if (!group.length) return null
        return (
          <section key={kind} className="flex flex-col gap-3">
            <h2 className="m-0 text-sm font-semibold">
              {KIND_LABEL[kind]} <span className="font-mono text-xs font-normal text-dim">{group.length}</span>
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {group.map((t) => (
                <TokenTile key={t.oracle_id} token={t} onChange={change} />
              ))}
            </div>
          </section>
        )
      })}
      {hidden.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm text-muted">Hidden {hidden.length}</summary>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
            {hidden.map((t) => (
              <TokenTile key={t.oracle_id} token={t} onChange={change} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
