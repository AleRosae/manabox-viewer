import clsx from 'clsx'
import { Minus, Plus } from 'lucide-react'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  /** soft maximum: shown as "di N"; the value can still exceed it */
  of?: number
  size?: 'sm' | 'md'
  label?: string
}

export function QtyStepper({ value, onChange, min = 0, of, size = 'md', label = 'copie' }: Props) {
  const box = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'
  const over = of != null && value > of
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Meno ${label}`}
        className={clsx(box, 'flex items-center justify-center rounded-[7px] border border-line-3 bg-bar text-fg hover:border-dim disabled:opacity-40')}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus size={14} />
      </button>
      <span className={clsx('min-w-7 text-center font-mono text-[15px]', over && 'text-warn-fg')} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Più ${label}`}
        className={clsx(box, 'flex items-center justify-center rounded-[7px] border border-line-3 bg-bar text-fg hover:border-dim')}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={14} />
      </button>
      {of != null && <span className="ml-1 min-w-11 text-xs text-dim">di {of}</span>}
    </div>
  )
}
