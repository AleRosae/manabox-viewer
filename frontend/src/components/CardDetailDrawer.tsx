import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, Minus, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtEur, isDoubleFaced, marketPrice } from '../lib/cards'
import type { Card } from '../lib/types'
import { useCollectionIndex, useData, useUsdRate } from '../store/data'
import { AddToListForm } from './AddToList'
import { CardImage } from './CardImage'
import { ManaCost, OracleText } from './ManaCost'

const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander']

function Faces({ card }: { card: Card }) {
  const faces = card.faces.length ? card.faces : [card]
  return (
    <div className="flex flex-col gap-3">
      {faces.map((f, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          {faces.length > 1 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{f.name}</span>
              <ManaCost cost={f.mana_cost} size={15} />
            </div>
          )}
          <div className="text-sm text-soft">{f.type_line}</div>
          {f.oracle_text && (
            <div className="rounded-[10px] border border-line bg-panel-2 px-3.5 py-3 text-sm leading-relaxed">
              <OracleText text={f.oracle_text} />
            </div>
          )}
          {(f.power != null || f.loyalty != null) && (
            <div className="font-mono text-sm text-muted">{f.loyalty != null ? `Loyalty ${f.loyalty}` : `${f.power}/${f.toughness}`}</div>
          )}
        </div>
      ))}
    </div>
  )
}

export function CardDetailDrawer({ card, onClose }: { card: Card | null; onClose: () => void }) {
  return (
    <Dialog.Root open={card != null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-full flex-col gap-6 overflow-y-auto border-l border-line-2 bg-[#13151B] px-7 pb-12 pt-6 shadow-[-24px_0_60px_rgba(0,0,0,.35)] outline-none">
          {card && <DetailBody card={card} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DetailBody({ card }: { card: Card }) {
  const index = useCollectionIndex()
  const collection = useData((s) => s.collection)
  const usage = useData((s) => s.usage)
  const lists = useData((s) => s.lists)
  const rate = useUsdRate()
  const [face, setFace] = useState(0)

  const rows = index?.rowsByOracle.get(card.oracle_id) ?? []
  const owned = rows.reduce((n, r) => n + r.quantity, 0)
  const purchase = rows.reduce((n, r) => n + (r.purchase_price ?? 0) * r.quantity, 0)
  const market = rows.reduce((n, r) => {
    const c = collection?.cards[r.scryfall_id ?? '']
    return n + (c ? (marketPrice(c, r.finish, rate) ?? 0) : 0) * r.quantity
  }, 0)
  const delta = purchase > 0 ? ((market - purchase) / purchase) * 100 : null
  const inLists = Object.entries(usage[card.oracle_id] ?? {})
  const used = inLists.reduce((n, [, q]) => n + q, 0)

  const removeOne = async (listId: number) => {
    await api.bulkItems(listId, [{ scryfall_id: card.id, quantity: -1 }])
    await useData.getState().listsChanged()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="facet">Details</span>
        <Dialog.Close className="btn btn-icon" aria-label="Close">
          <X size={16} />
        </Dialog.Close>
      </div>

      <div className="flex flex-wrap gap-5">
        <div className="relative w-[190px] shrink-0">
          <CardImage card={card} face={face} size="large" eager />
          {isDoubleFaced(card) && (
            <button type="button" aria-label="Flip card" className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-bg/85 hover:bg-chip" onClick={() => setFace(1 - face)}>
              <RefreshCw size={15} />
            </button>
          )}
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col gap-2.5">
          <Dialog.Title className="m-0 text-2xl font-bold tracking-[-0.01em]">{card.name}</Dialog.Title>
          <Dialog.Description className="sr-only">Details for {card.name}</Dialog.Description>
          <div className="flex items-center gap-3">
            <ManaCost cost={card.faces.length ? card.faces[0].mana_cost : card.mana_cost} size={20} />
            <span className="font-mono text-[13px] text-muted">MV {card.cmc}</span>
          </div>
          <div className="text-xs text-dim">
            {card.set_name} · {card.set.toUpperCase()} #{card.collector_number} · <span className="capitalize">{card.rarity}</span>
            {card.artist && ` · ${card.artist}`}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[10px] border border-line bg-panel-2 px-3 py-2.5">
              <div className="text-[11px] text-dim">Purchase (total)</div>
              <div className="mt-0.5 font-mono text-[17px]">{owned ? fmtEur(purchase) : '—'}</div>
            </div>
            <div className="rounded-[10px] border border-line bg-panel-2 px-3 py-2.5">
              <div className="text-[11px] text-dim">Market (total)</div>
              <div className="mt-0.5 font-mono text-[17px]">
                {owned ? fmtEur(market) : fmtEur(marketPrice(card, 'normal', rate))}{' '}
                {delta != null && (
                  <span className={delta >= 0 ? 'text-xs text-ok' : 'text-xs text-bad'}>
                    {delta >= 0 ? '+' : ''}
                    {delta.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Faces card={card} />

      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h3 className="facet m-0">Owned copies</h3>
          <span className="font-mono text-[13px]">
            {owned} {owned === 1 ? 'copy' : 'copies'} · {new Set(rows.map((r) => r.binder_name)).size} binder{new Set(rows.map((r) => r.binder_name)).size === 1 ? '' : 's'}
          </span>
        </div>
        {rows.length > 0 ? (
          <div className="overflow-hidden rounded-[10px] border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-panel-2 text-left text-dim">
                  <th className="px-3 py-2 font-medium">Binder</th>
                  <th className="px-3 py-2 font-medium">Printing</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">€ market</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = collection?.cards[r.scryfall_id ?? '']
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-3 py-2.5">{r.binder_name}</td>
                      <td className="px-3 py-2.5 font-mono text-muted">
                        {r.set_code} #{r.collector_number}
                        {r.finish !== 'normal' && <span className="ml-1.5 text-accent-hi">{r.finish}</span>}
                        {r.language && r.language !== 'en' && <span className="ml-1.5 uppercase">{r.language}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{r.quantity}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{c ? fmtEur(marketPrice(c, r.finish, rate)) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 text-sm text-dim">You don't own this card.</p>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h3 className="facet m-0">In your lists</h3>
          {used > 0 && (
            <span className="text-xs text-muted">
              {used} of {owned} copies used
            </span>
          )}
        </div>
        {inLists.map(([lid, q]) => {
          const list = lists.find((l) => String(l.id) === lid)
          if (!list) return null
          return (
            <div key={lid} className="flex items-center justify-between rounded-[10px] border border-line bg-panel-2 py-1.5 pl-3.5 pr-1.5 text-sm">
              <Link to={`/lists/${lid}`} className="hover:text-accent">
                {list.name}
              </Link>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted">×{q}</span>
                <button type="button" className="btn btn-ghost btn-icon min-h-9 w-9" aria-label={`Remove one copy from ${list.name}`} onClick={() => void removeOne(list.id)}>
                  <Minus size={14} />
                </button>
              </span>
            </div>
          )
        })}
        <div className="rounded-[10px] border border-warn-line bg-[#1E1A12] px-3.5 py-3">
          <AddToListForm card={card} />
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="facet m-0">Legality</h3>
        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((f) => {
            const ok = card.legal.includes(f)
            return (
              <span key={f} className={ok ? 'rounded-md bg-[#1F3A2A] px-2 py-1 text-[11.5px] font-medium capitalize text-[#8FDCA9]' : 'rounded-md bg-chip px-2 py-1 text-[11.5px] font-medium capitalize text-dim line-through'}>
                {f}
              </span>
            )
          })}
        </div>
      </section>

      {card.scryfall_uri && (
        <a href={card.scryfall_uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:text-accent-hi">
          Open on Scryfall <ExternalLink size={13} />
        </a>
      )}
    </>
  )
}
