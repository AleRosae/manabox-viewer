import { ClipboardPaste, Layers } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ImportListDialog } from '../components/ImportListDialog'
import { asDeck, DECK_MESSAGE, MOXFIELD_ORIGIN, parseDeckJson, READY_MESSAGE } from '../lib/moxfield'
import { listPath } from '../lib/paths'
import type { MoxfieldDeck } from '../lib/types'
import { useData } from '../store/data'
import { usePendingMoxfield } from '../store/ui'

/**
 * Where the bookmarklet sends a Moxfield deck: a deck already linked to it opens its sync, any
 * other deck is offered for import. When the browser cut the link with the Moxfield tab, the deck
 * the bookmarklet copied to the clipboard can be pasted here.
 */
export function MoxfieldSyncPage() {
  const navigate = useNavigate()
  const lists = useData((s) => s.lists)
  const [incoming, setIncoming] = useState<MoxfieldDeck | null>(null)
  const [pasted, setPasted] = useState('')

  useEffect(() => {
    if (incoming) return
    const onMessage = (e: MessageEvent) => {
      if (!MOXFIELD_ORIGIN.test(e.origin) || e.data?.type !== DECK_MESSAGE) return
      const deck = asDeck(e.data.deck)
      if (deck) setIncoming(deck)
    }
    window.addEventListener('message', onMessage)
    // The Moxfield tab answers our ping with the deck, once it has read it.
    const ping = () => window.opener?.postMessage(READY_MESSAGE, '*')
    ping()
    const timer = window.setInterval(ping, 500)
    const stop = window.setTimeout(() => window.clearInterval(timer), 30_000)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [incoming])

  const linked = incoming ? lists.find((l) => l.kind === 'deck' && l.remote_source === 'moxfield' && l.remote_id === incoming.id) : undefined
  useEffect(() => {
    if (!incoming || !linked) return
    usePendingMoxfield.getState().set(incoming)
    navigate(listPath(linked), { replace: true })
  }, [incoming, linked, navigate])

  const paste = (text: string) => {
    const deck = parseDeckJson(text)
    if (deck) setIncoming(deck)
    else toast.error('This is not a deck copied by the bookmarklet')
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-20 text-center">
      <Layers size={32} className="text-accent" />
      <span className="text-lg font-semibold">{incoming ? `“${incoming.name}” from Moxfield` : 'Waiting for the deck from Moxfield…'}</span>
      {!incoming && (
        <>
          <span className="text-sm text-muted">
            If nothing happens, the bookmarklet copied the deck to the clipboard: paste it here.
          </span>
          <div className="flex w-full gap-2">
            <textarea className="field min-h-24 flex-1 resize-y py-2 font-mono text-[12px]" aria-label="Deck copied by the bookmarklet" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <button type="button" className="btn self-start" disabled={!pasted.trim()} onClick={() => paste(pasted)}>
              <ClipboardPaste size={15} /> Use
            </button>
          </div>
        </>
      )}
      {incoming && !linked && <ImportListDialog kind="deck" moxfield={incoming} onClose={() => navigate('/decks', { replace: true })} />}
    </main>
  )
}
