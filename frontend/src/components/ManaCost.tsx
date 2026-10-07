import clsx from 'clsx'

const SYMBOL_STYLE: Record<string, { bg: string; fg: string }> = {
  W: { bg: '#F0E6C8', fg: '#3A3320' },
  U: { bg: '#4A90D9', fg: '#fff' },
  B: { bg: '#4B4150', fg: '#fff' },
  R: { bg: '#C9503A', fg: '#fff' },
  G: { bg: '#3E8E5E', fg: '#fff' },
}
const GENERIC = { bg: '#9AA0AA', fg: '#111' }

function Symbol({ sym, size }: { sym: string; size: number }) {
  const parts = sym.split('/')
  const colored = parts.filter((p) => SYMBOL_STYLE[p])
  let background = GENERIC.bg
  let color = GENERIC.fg
  let label = sym
  if (colored.length === 2) {
    // hybrid: split circle
    background = `linear-gradient(135deg, ${SYMBOL_STYLE[colored[0]].bg} 50%, ${SYMBOL_STYLE[colored[1]].bg} 50%)`
    label = ''
  } else if (colored.length === 1) {
    background = SYMBOL_STYLE[colored[0]].bg
    color = SYMBOL_STYLE[colored[0]].fg
    label = parts.includes('P') ? 'φ' : parts.length > 1 ? parts[0] : colored[0]
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold leading-none"
      style={{ width: size, height: size, fontSize: size * 0.62, background, color }}
      title={`{${sym}}`}
    >
      {label}
    </span>
  )
}

export function ManaCost({ cost, size = 16, className }: { cost: string; size?: number; className?: string }) {
  if (!cost) return null
  const faces = cost.split(' // ')
  return (
    <span className={clsx('inline-flex items-center gap-[3px]', className)}>
      {faces.map((face, fi) => (
        <span key={fi} className="inline-flex items-center gap-[2px]">
          {fi > 0 && <span className="mx-1 text-dim">//</span>}
          {[...face.matchAll(/\{([^}]+)\}/g)].map((m, i) => (
            <Symbol key={i} sym={m[1]} size={size} />
          ))}
        </span>
      ))}
    </span>
  )
}

/** Renders oracle text replacing {X} symbols inline. */
export function OracleText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, li) => (
        <p key={li} className="m-0 [&+p]:mt-2">
          {line.split(/(\{[^}]+\})/g).map((part, i) =>
            /^\{[^}]+\}$/.test(part) ? (
              <span key={i} className="mx-px inline-block align-[-2px]">
                <Symbol sym={part.slice(1, -1)} size={14} />
              </span>
            ) : (
              part
            ),
          )}
        </p>
      ))}
    </>
  )
}
