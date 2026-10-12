import * as Popover from '@radix-ui/react-popover'
import clsx from 'clsx'
import { ChevronDown, Download, Link2, RefreshCw, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type ExportFormat } from '../../lib/api'
import type { ListDetail } from '../../lib/types'
import { useData } from '../../store/data'

interface ExportEntry {
  label: string
  hint: string
  format: ExportFormat
  disabled?: boolean
}

function MenuLink({ listId, entry }: { listId: number; entry: ExportEntry }) {
  return (
    <a
      className={clsx('flex flex-col rounded-lg px-3 py-2 hover:bg-panel-2', entry.disabled && 'pointer-events-none opacity-45')}
      href={api.exportUrl(listId, entry.format)}
      download
      aria-disabled={entry.disabled}
    >
      <span className="text-sm">{entry.label}</span>
      <span className="text-xs text-dim">{entry.hint}</span>
    </a>
  )
}

/** Unlink from the remote list, or link it (opens the sync dialog). */
function RemoteEntry({ list, service, onLink }: { list: ListDetail; service: string; onLink: () => void }) {
  if (list.remote_source)
    return (
      <button
        type="button"
        className="flex flex-col rounded-lg px-3 py-2 text-left hover:bg-panel-2"
        onClick={async () => {
          if (!window.confirm(`Unlink from ${service}? The cards stay.`)) return
          try {
            await api.updateList(list.id, { unlink: true })
            await useData.getState().listsChanged()
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      >
        <span className="text-sm">Unlink from {service}</span>
        <span className="text-xs text-dim">keep the cards, stop syncing</span>
      </button>
    )
  return (
    <button type="button" className="flex flex-col rounded-lg px-3 py-2 text-left hover:bg-panel-2" onClick={onLink}>
      <span className="flex items-center gap-1.5 text-sm">
        <Link2 size={14} /> Link to {service}…
      </span>
      <span className="text-xs text-dim">sync the cards from it</span>
    </button>
  )
}

interface ActionsProps {
  list: ListDetail
  /** copies not owned, over the whole list */
  missing: number
  onSync: () => void
}

function ExportMenu({ list, entries, service, onSync }: { list: ListDetail; entries: ExportEntry[]; service: string; onSync: () => void }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="btn">
        <Download size={15} /> Export <ChevronDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 flex w-72 flex-col rounded-xl border border-[#3A3F4B] bg-raised p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.55)]">
          {entries.map((e) => (
            <MenuLink key={e.format} listId={list.id} entry={e} />
          ))}
          <div className="my-1 border-t border-line" />
          <MenuLink listId={list.id} entry={{ label: 'Tokens .txt', hint: 'tokens, emblems and markers the cards make', format: 'tokens' }} />
          <MenuLink listId={list.id} entry={{ label: 'Missing tokens .txt', hint: "only the tokens you don't own", format: 'tokens_missing' }} />
          <div className="my-1 border-t border-line" />
          <RemoteEntry list={list} service={service} onLink={onSync} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const ShareButton = ({ list }: { list: ListDetail }) => (
  <a className="btn" href={api.exportUrl(list.id, 'viewer')} download title="ManaBox Viewer list with your ownership: another user can import it and compare">
    <Share2 size={15} /> Share
  </a>
)

const SyncButton = ({ service, onSync }: { service: string; onSync: () => void }) => (
  <button type="button" className="btn" onClick={onSync} title={`Update from ${service}`}>
    <RefreshCw size={15} /> Sync
  </button>
)

export function CubeActions({ list, missing, onSync }: ActionsProps) {
  return (
    <>
      {list.remote_source === 'cubecobra' && <SyncButton service="CubeCobra" onSync={onSync} />}
      <ShareButton list={list} />
      <ExportMenu
        list={list}
        service="CubeCobra"
        onSync={onSync}
        entries={[
          { label: 'List .txt', hint: '“1 Name (SET) 123”, for any deck tool', format: 'txt' },
          { label: 'Missing cards .txt', hint: "only the copies you don't own", format: 'missing', disabled: missing === 0 },
          { label: 'Missing cards, names only', hint: 'for shops with their own set codes (CardTrader)', format: 'missing_names', disabled: missing === 0 },
        ]}
      />
      <a className="btn btn-primary" href={api.exportUrl(list.id, 'cubecobra_csv')} download>
        <Download size={15} /> CubeCobra CSV
      </a>
    </>
  )
}

export function DeckActions({ list, missing, onSync }: ActionsProps) {
  return (
    <>
      {list.remote_source === 'moxfield' && <SyncButton service="Moxfield" onSync={onSync} />}
      <ShareButton list={list} />
      <ExportMenu
        list={list}
        service="Moxfield"
        onSync={onSync}
        entries={[
          { label: 'Deck .txt', hint: 'with Commander/Sideboard sections, for Moxfield or Arena', format: 'deck' },
          { label: 'Missing cards .txt', hint: "copies you don't own, maybeboard excluded", format: 'missing', disabled: missing === 0 },
          { label: 'Missing cards, names only', hint: 'for shops with their own set codes (CardTrader)', format: 'missing_names', disabled: missing === 0 },
        ]}
      />
    </>
  )
}
