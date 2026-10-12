import { Bookmark } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { bookmarklet } from '../../lib/moxfield'

/** The "Sync from Moxfield" link to drag to the bookmarks bar. */
export function MoxfieldBookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    // React refuses javascript: URLs in href: set it on the element.
    ref.current?.setAttribute('href', bookmarklet(window.location.origin))
  }, [])
  return (
    <a
      ref={ref}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-accent px-1.5 py-0.5 text-accent"
      title="Drag me to the bookmarks bar, then click the bookmark on a Moxfield deck"
      onClick={(e) => e.preventDefault()}
    >
      <Bookmark size={12} /> Sync to ManaBox Viewer
    </a>
  )
}
