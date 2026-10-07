import clsx from 'clsx'
import { useState } from 'react'
import { imageUrl } from '../lib/api'
import type { Card } from '../lib/types'

interface Props {
  card: Card
  face?: number
  size?: 'normal' | 'large'
  className?: string
  dimmed?: boolean
  eager?: boolean
}

/** Card image served (and cached) by the backend, with a skeleton and a text fallback. */
export function CardImage({ card, face = 0, size = 'normal', className, dimmed, eager }: Props) {
  const src = imageUrl(card.id, size, face)
  // Track which src finished loading so that flipping faces shows the skeleton again.
  const [done, setDone] = useState<{ src: string; ok: boolean } | null>(null)
  const state = done?.src !== src ? 'loading' : done.ok ? 'ok' : 'error'
  return (
    <div
      className={clsx(
        'relative aspect-[488/680] overflow-hidden rounded-[4.75%/3.5%] bg-panel-2',
        state === 'loading' && 'animate-pulse',
        className,
      )}
    >
      {state === 'error' ? (
        <div className="flex h-full flex-col justify-between p-3 text-xs text-muted">
          <span className="font-semibold text-fg">{card.faces[face]?.name ?? card.name}</span>
          <span>{card.type_line}</span>
        </div>
      ) : (
        <img
          src={src}
          alt={card.faces[face]?.name ?? card.name}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setDone({ src, ok: true })}
          onError={() => setDone({ src, ok: false })}
          className={clsx(
            'h-full w-full object-cover transition-[opacity,filter] duration-300',
            state === 'loading' ? 'opacity-0' : 'opacity-100',
            dimmed && 'grayscale-[85%] brightness-[.55]',
          )}
        />
      )}
    </div>
  )
}
