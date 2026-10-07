import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Entry } from '../lib/types'
import { CardTile } from './CardTile'

const MIN_TILE = 168
const GAP = 18
const FOOTER = 30

interface Props {
  entries: Entry[]
  selected: Set<string>
  selectionMode: boolean
  showBinders: boolean
  onSelect: (key: string, index: number, shift: boolean) => void
  onOpen: (key: string) => void
}

/** Window-virtualized responsive grid: only visible rows are rendered. */
export function CollectionGrid({ entries, selected, selectionMode, showBinders, onSelect, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [offset, setOffset] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Content above the grid (errors, banners) can move it: keep the scroll margin in sync.
  useLayoutEffect(() => {
    const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY
    if (Math.abs(top - offset) > 1) setOffset(top)
  })

  const columns = Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP)))
  const tileWidth = (width - GAP * (columns - 1)) / columns
  const rowHeight = (tileWidth * 680) / 488 + FOOTER + GAP
  const rowCount = Math.ceil(entries.length / columns)

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin: offset,
  })

  // Row height depends on the width: re-measure when it changes.
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  return (
    <div ref={ref} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((vrow) => (
        <div
          key={vrow.key}
          className="absolute left-0 top-0 grid w-full"
          style={{
            transform: `translateY(${vrow.start - virtualizer.options.scrollMargin}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            columnGap: GAP,
          }}
        >
          {entries.slice(vrow.index * columns, vrow.index * columns + columns).map((entry, i) => {
            const index = vrow.index * columns + i
            return (
              <CardTile
                key={entry.key}
                entry={entry}
                index={index}
                selected={selected.has(entry.key)}
                selectionMode={selectionMode}
                showBinders={showBinders}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
