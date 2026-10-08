import * as Popover from '@radix-ui/react-popover'
import { CircleHelp, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { QUERY_HELP } from '../lib/query'

interface Props {
  value: string
  onChange: (v: string) => void
  errors: string[]
  placeholder?: string
}

/** Text query with Scryfall syntax; commits after a short pause or on Enter. */
export function SearchBar({ value, onChange, errors, placeholder }: Props) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value) return
    const t = window.setTimeout(() => onChange(draft), 250)
    return () => window.clearTimeout(t)
  }, [draft, value, onChange])

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-line-3 bg-[#15171D] px-4 focus-within:border-accent">
        <Search size={18} className="shrink-0 text-muted" />
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[15px] text-fg outline-none placeholder:font-sans placeholder:text-dim"
          aria-label="Search with Scryfall syntax"
          placeholder={placeholder ?? 'Search… e.g. t:creature c<=ug mv<=3 r>=rare'}
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onChange(draft)
            if (e.key === 'Escape') setDraft('')
          }}
        />
        {draft && (
          <button type="button" className="btn btn-ghost btn-icon min-h-8 w-8" aria-label="Clear search" onClick={() => onChange('')}>
            <X size={16} />
          </button>
        )}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="flex items-center gap-1.5 whitespace-nowrap text-xs text-dim hover:text-fg">
              <CircleHelp size={15} />
              <span className="hidden sm:inline">Syntax</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={10}
              collisionPadding={12}
              className="z-40 max-h-[70vh] w-[560px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line-3 bg-raised p-4 shadow-[0_20px_50px_rgba(0,0,0,.6)]"
            >
              <div className="mb-3 text-sm font-semibold">Search syntax (Scryfall-style)</div>
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-[13px]">
                {QUERY_HELP.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-accent">{k}</dt>
                    <dd className="m-0 text-soft">{v}</dd>
                  </div>
                ))}
              </dl>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </label>
      {errors.length > 0 && <p className="m-0 px-1 text-xs text-warn-fg">{errors.join(' · ')}</p>}
    </div>
  )
}
