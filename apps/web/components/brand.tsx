import type { CSSProperties } from 'react'

// The logo file is white on transparent; used as a mask it takes the current text colour, so it
// works on dark and light surfaces alike.
const LOGO_MASK: CSSProperties = {
  maskImage: 'url(/brand/jbp-capital.png)',
  WebkitMaskImage: 'url(/brand/jbp-capital.png)',
  maskSize: 'contain',
  WebkitMaskSize: 'contain',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
}

/** "by" followed by the JBP Capital logo. */
export function Byline({ by, size = 'h-10', className = '' }: { by: string; size?: string; className?: string }) {
  return (
    <span className={`flex items-center gap-2 text-muted ${className}`}>
      <span className="text-xs italic">{by}</span>
      <span role="img" aria-label="JBP Capital" className={`block aspect-[206/160] bg-current transition-colors ${size}`} style={LOGO_MASK} />
    </span>
  )
}
