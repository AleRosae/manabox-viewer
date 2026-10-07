import { Bar as RBar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { BUCKET_COLOR, BUCKET_LABEL, fmtEur, fmtNum } from '../lib/cards'
import type { Stats } from '../lib/stats'

const RARITY_COLOR: Record<string, string> = {
  common: '#5A5F68',
  uncommon: '#A9B4C2',
  rare: '#D9B45A',
  mythic: '#E0703A',
  special: '#9C7FD1',
  bonus: '#9C7FD1',
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel flex flex-col gap-1 px-[18px] py-4">
      <span className="text-xs text-dim">{label}</span>
      <span className="font-mono text-[26px] font-medium tracking-[-0.02em]">{value}</span>
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </div>
  )
}

function Panel({ title, note, children, wide }: { title: string; note?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`panel flex min-w-0 flex-col gap-4 px-[22px] py-5 ${wide ? 'col-span-full' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        {note && <span className="text-xs text-dim">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function HBars({ bars, color, labelWidth = 110, format = fmtNum }: { bars: { key: string; label: React.ReactNode; value: number; color?: string; extra?: string }[]; color?: string; labelWidth?: number; format?: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <div className="flex flex-col gap-2.5">
      {bars.map((b) => (
        <div key={b.key} className="grid items-center gap-3 text-[13px]" style={{ gridTemplateColumns: `minmax(0, ${labelWidth}px) minmax(0, 1fr) auto` }}>
          <span className="truncate">{b.label}</span>
          <div className="h-2.5 rounded-full bg-[#1D2028]">
            <div className="h-full rounded-full" style={{ width: `${(b.value / max) * 100}%`, background: b.color ?? color ?? '#7FA7D9', minWidth: b.value ? 4 : 0 }} />
          </div>
          <span className="min-w-12 text-right font-mono text-muted">
            {format(b.value)}
            {b.extra && <span className="text-dim"> · {b.extra}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

interface Props {
  stats: Stats
  showPurchase?: boolean
  showBinders?: boolean
  topTitle?: string
  onCardClick?: (cardId: string) => void
}

export function StatsView({ stats, showPurchase = true, showBinders = false, topTitle = 'Carte di maggior valore', onCardClick }: Props) {
  const delta = stats.purchaseValue ? ((stats.marketValue - stats.purchaseValue) / stats.purchaseValue) * 100 : null
  const rarityTotal = stats.rarity.reduce((n, r) => n + r.value, 0) || 1

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3.5">
        <Kpi
          label="Valore di mercato"
          value={fmtEur(stats.marketValue)}
          hint={
            delta != null
              ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs acquisto`
              : stats.missingPrice
                ? `${fmtNum(stats.missingPrice)} copie senza prezzo`
                : 'Scryfall, EUR'
          }
        />
        {showPurchase && <Kpi label="Valore d'acquisto" value={fmtEur(stats.purchaseValue)} hint="dal CSV ManaBox" />}
        <Kpi label="Copie" value={fmtNum(stats.copies)} hint={`${fmtNum(stats.foilCopies)} foil / etched`} />
        <Kpi label="Carte uniche" value={fmtNum(stats.unique)} hint="per nome" />
        <Kpi label="Espansioni" value={fmtNum(stats.sets)} hint={stats.avgMv != null ? `MV medio ${stats.avgMv.toFixed(2).replace('.', ',')}` : undefined} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
        <Panel title="Colori" note="mono · multi · incolore · terre">
          <HBars
            labelWidth={100}
            bars={stats.colors.map((b) => ({
              key: b.key,
              value: b.value,
              color: BUCKET_COLOR[b.key],
              label: (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full shadow-[0_0_0_1px_#3A3F4B]" style={{ background: BUCKET_COLOR[b.key] }} />
                  {BUCKET_LABEL[b.key]}
                </span>
              ),
            }))}
          />
        </Panel>

        <Panel title="Curva di mana" note="terre escluse">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.curve} margin={{ top: 22, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#2C303A' }} tick={{ fill: '#7D8490', fontSize: 12, fontFamily: 'Geist Mono' }} />
                <Tooltip
                  cursor={{ fill: '#ffffff08' }}
                  contentStyle={{ background: '#1B1E26', border: '1px solid #343946', borderRadius: 10, fontSize: 13 }}
                  labelFormatter={(l) => `MV ${l}`}
                  formatter={(v) => [fmtNum(Number(v)), 'copie']}
                />
                <RBar dataKey="value" fill="#E8A33D" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="value" position="top" fill="#9AA0AA" fontSize={11} fontFamily="Geist Mono" formatter={(v) => (Number(v) ? fmtNum(Number(v)) : '')} />
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Rarità">
          <div className="flex h-[18px] gap-0.5 overflow-hidden rounded-full">
            {stats.rarity.map((r) => (
              <div key={r.key} title={`${r.label}: ${r.value}`} style={{ width: `${(r.value / rarityTotal) * 100}%`, background: RARITY_COLOR[r.key] }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-[13px]">
            {stats.rarity.map((r) => (
              <span key={r.key} className="flex items-center gap-2 capitalize">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: RARITY_COLOR[r.key] }} />
                {r.label}
                <span className="ml-auto font-mono text-muted">{fmtNum(r.value)}</span>
              </span>
            ))}
          </div>
          <h2 className="m-0 mt-2 text-[15px] font-semibold">Tipi</h2>
          <HBars bars={stats.types} color="#A98BD6" />
        </Panel>

        <Panel title="Espansioni" note={`top ${stats.topSets.length} per copie`}>
          <HBars
            labelWidth={200}
            bars={stats.topSets.map((s) => ({
              ...s,
              label: (
                <span>
                  <span className="mr-2 font-mono text-dim">{s.key.toUpperCase()}</span>
                  {s.label}
                </span>
              ),
            }))}
          />
        </Panel>

        {showBinders && stats.binders.length > 0 && (
          <Panel title="Binder" note="copie · valore di mercato">
            <HBars labelWidth={120} bars={stats.binders.map((b) => ({ ...b, extra: fmtEur(stats.binderValue[b.key] ?? 0) }))} />
          </Panel>
        )}

        {stats.top.length > 0 && (
          <Panel title={topTitle} wide>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="text-left text-dim">
                    <th className="px-2.5 py-2 font-medium">#</th>
                    <th className="px-2.5 py-2 font-medium">Carta</th>
                    <th className="px-2.5 py-2 font-medium">Set</th>
                    <th className="px-2.5 py-2 text-right font-medium">Copie</th>
                    <th className="px-2.5 py-2 text-right font-medium">€ mercato</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top.map((t, i) => (
                    <tr key={t.card.id + i} className="border-t border-line">
                      <td className="px-2.5 py-2.5 font-mono text-dim">{i + 1}</td>
                      <td className="px-2.5 py-2.5 font-medium">
                        {onCardClick ? (
                          <button type="button" className="text-left hover:text-accent" onClick={() => onCardClick(t.card.id)}>
                            {t.card.name}
                          </button>
                        ) : (
                          t.card.name
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 font-mono text-muted">{t.card.set.toUpperCase()}</td>
                      <td className="px-2.5 py-2.5 text-right font-mono">{t.quantity}</td>
                      <td className="px-2.5 py-2.5 text-right font-mono">{fmtEur(t.unitMarket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
