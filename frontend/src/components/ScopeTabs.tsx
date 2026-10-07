import clsx from 'clsx'
import { fmtNum } from '../lib/cards'
import { useCollectionIndex } from '../store/data'

/** "All binders" or a single binder. */
export function ScopeTabs({ scope, onChange }: { scope: string; onChange: (s: string) => void }) {
  const index = useCollectionIndex()
  const binders = index?.binders ?? []
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Collezione" className="flex flex-wrap rounded-[10px] border border-line bg-[#15171D] p-[3px]">
        <button type="button" aria-pressed={scope === 'all'} className={clsx('seg', scope === 'all' && 'seg-on')} onClick={() => onChange('all')}>
          Tutte le collezioni
        </button>
        {binders.map((b) => (
          <button key={b.name} type="button" aria-pressed={scope === b.name} className={clsx('seg', scope === b.name && 'seg-on')} onClick={() => onChange(b.name)}>
            {b.name}
            <span className="ml-1.5 font-mono text-dim">{fmtNum(b.quantity)}</span>
          </button>
        ))}
      </div>
      {scope === 'all' && <span className="text-xs text-dim">Raggruppate per nome · stampe e binder nel dettaglio</span>}
    </div>
  )
}
