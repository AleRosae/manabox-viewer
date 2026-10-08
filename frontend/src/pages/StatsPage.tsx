import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CardDetailDrawer } from '../components/CardDetailDrawer'
import { ScopeTabs } from '../components/ScopeTabs'
import { StatsView } from '../components/StatsView'
import { buildEntries } from '../lib/cards'
import { computeStats } from '../lib/stats'
import { useData, useUsdRate } from '../store/data'
import { useDetail } from '../store/ui'

export function StatsPage() {
  const collection = useData((s) => s.collection)
  const rate = useUsdRate()
  const [params, setParams] = useSearchParams()
  const scope = params.get('scope') ?? 'all'
  const { entryKey, open, close } = useDetail()

  const stats = useMemo(() => {
    if (!collection) return null
    // Always aggregate per card so "unique cards" and the top list are per card, not per row.
    const scopedRows = scope === 'all' ? collection.rows : collection.rows.filter((r) => r.binder_name === scope)
    const entries = buildEntries(scopedRows, collection.cards, 'all', rate)
    return computeStats(
      entries.map((e) => {
        const binderQty: Record<string, number> = {}
        for (const r of e.rows) binderQty[r.binder_name] = (binderQty[r.binder_name] ?? 0) + r.quantity
        return {
          card: e.card,
          quantity: e.quantity,
          unitMarket: e.quantity ? e.marketValue / e.quantity : null,
          purchaseValue: e.purchaseValue,
          foil: e.foil,
          binderQty,
        }
      }),
    )
  }, [collection, scope, rate])

  const detailCard = entryKey && collection ? (collection.cards[entryKey] ?? null) : null
  if (!stats) return null

  return (
    <main className="mx-auto flex w-full max-w-[1360px] flex-col gap-[22px] px-4 pb-14 pt-[26px] sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3.5">
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em]">Collection stats</h1>
      </div>
      <ScopeTabs scope={scope} onChange={(s) => setParams(s === 'all' ? {} : { scope: s }, { replace: true })} />
      <StatsView stats={stats} showBinders={scope === 'all'} onCardClick={open} />
      <CardDetailDrawer card={detailCard} onClose={close} />
    </main>
  )
}
