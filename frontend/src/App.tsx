import clsx from 'clsx'
import { Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { HoverPreview } from './components/HoverPreview'
import { fmtDate } from './lib/cards'
import { CollectionPage } from './pages/CollectionPage'
import { ImportPage } from './pages/ImportPage'
import { ListsPage } from './pages/ListsPage'
import { StatsPage } from './pages/StatsPage'
import { useData } from './store/data'
import { useDetail, useHover } from './store/ui'

function Logo() {
  return (
    <Link to="/" className="mr-3 flex items-center gap-2.5">
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-accent">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14110B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="3" width="11" height="15" rx="2" />
          <path d="M9 21h8a2 2 0 0 0 2-2V7" />
        </svg>
      </span>
      <span className="text-base font-bold tracking-[-0.01em]">ManaBox Viewer</span>
    </Link>
  )
}

function Header() {
  const status = useData((s) => s.status)
  const current = status?.current_import
  const nav = ({ isActive }: { isActive: boolean }) =>
    clsx('rounded-lg px-3.5 py-2.5 text-sm font-medium', isActive ? 'bg-[#1D2028] text-fg' : 'text-muted hover:text-fg')
  return (
    <header className="z-30 flex min-h-[69px] lg:sticky lg:top-0 flex-wrap items-center gap-4 border-b border-line bg-bar/95 px-4 py-3 backdrop-blur sm:px-7">
      <Logo />
      {current && (
        <nav className="flex flex-wrap gap-0.5">
          <NavLink to="/" end className={nav}>
            Collection
          </NavLink>
          <NavLink to="/stats" className={nav}>
            Stats
          </NavLink>
          <NavLink to="/lists" className={nav}>
            Lists
          </NavLink>
        </nav>
      )}
      <span className="flex-1" />
      {!!status?.pending_cards && (
        <Link to="/import" className="text-xs text-accent hover:underline" title="Scryfall did not answer during the import: retry from the import page">
          {status.pending_cards} {status.pending_cards === 1 ? 'card' : 'cards'} not loaded
        </Link>
      )}
      {current && (
        <span className="hidden text-xs text-dim md:inline">
          Export {fmtDate(current.imported_at)} · prices {fmtDate(status?.prices.updated_at ?? current.imported_at)}
        </span>
      )}
      <Link to="/import" className="btn">
        <Upload size={15} /> Import export
      </Link>
    </header>
  )
}

function RouteEffects() {
  const location = useLocation()
  useEffect(() => {
    useDetail.getState().close()
    useHover.getState().hide()
  }, [location.pathname])
  return null
}

function AppRoutes() {
  const status = useData((s) => s.status)
  const collection = useData((s) => s.collection)
  const hasCollection = !!status?.current_import && !!collection
  return (
    <Routes>
      <Route path="/import" element={<ImportPage />} />
      {hasCollection ? (
        <>
          <Route path="/" element={<CollectionPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/lists/:id" element={<ListsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <Route path="*" element={<Navigate to="/import" replace />} />
      )}
    </Routes>
  )
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { loadStatus, loadCollection, loadLists } = useData.getState()
    ;(async () => {
      try {
        const status = await loadStatus()
        await Promise.all([status.current_import ? loadCollection() : null, loadLists()])
        setReady(true)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [])

  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col">
        <Header />
        {error ? (
          <div className="m-8 rounded-xl border border-bad/40 bg-panel p-6 text-sm">Backend not responding: {error}</div>
        ) : ready ? (
          <AppRoutes />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading collection…</div>
        )}
      </div>
      <RouteEffects />
      <HoverPreview />
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: '#1B1E26', border: '1px solid #343946', color: '#E8E6E3' } }} />
    </BrowserRouter>
  )
}
