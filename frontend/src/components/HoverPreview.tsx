import { useRef } from 'react'
import { isDoubleFaced } from '../lib/cards'
import type { Card } from '../lib/types'
import { useHover } from '../store/ui'
import { CardImage } from './CardImage'

const DELAY = 300
const WIDTH = 300
const HEIGHT = Math.round((WIDTH * 680) / 488)
const OFFSET = 24

/** Handlers that show the large preview after a short delay. */
export function useHoverPreview(card: Card, dimmed = false) {
  const timer = useRef<number | null>(null)
  const pos = useRef({ x: 0, y: 0 })
  const { show, move, hide } = useHover.getState()
  return {
    onMouseEnter: (e: React.MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => show(card, pos.current.x, pos.current.y, dimmed), DELAY)
    },
    onMouseMove: (e: React.MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY }
      if (useHover.getState().card) move(e.clientX, e.clientY)
    },
    onMouseLeave: () => {
      if (timer.current) window.clearTimeout(timer.current)
      hide()
    },
  }
}

export function HoverPreview() {
  const { card, x, y, dimmed } = useHover()
  if (!card) return null
  const faces = isDoubleFaced(card) ? [0, 1] : [0]
  const totalWidth = faces.length * WIDTH + (faces.length - 1) * 12
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Prefer the right of the cursor; flip to the left when there's no room.
  let left = x + OFFSET
  if (left + totalWidth > vw - 12) left = x - OFFSET - totalWidth
  left = Math.max(12, left)
  const top = Math.min(Math.max(12, y - HEIGHT / 2), vh - HEIGHT - 12)
  return (
    <div className="pointer-events-none fixed z-50 flex gap-3" style={{ left, top }} aria-hidden="true">
      {faces.map((face) => (
        <div key={face} className="relative" style={{ width: WIDTH }}>
          <CardImage
            card={card}
            face={face}
            size="large"
            eager
            dimmed={dimmed}
            className="shadow-[0_30px_80px_rgba(0,0,0,.65),0_0_0_1px_#343946]"
          />
          {dimmed && (
            <span className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-3 bg-bg px-3 py-2 text-xs font-semibold tracking-[0.06em] whitespace-nowrap">
              NON POSSEDUTA
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
