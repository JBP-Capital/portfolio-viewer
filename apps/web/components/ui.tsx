import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[linear-gradient(45deg,var(--gold),var(--gold-deep))] text-on-gold hover:brightness-110',
  secondary: 'bg-surface-highest text-gold hover:bg-surface-high',
  ghost: 'bg-transparent text-muted hover:text-text',
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 px-5 text-sm font-semibold tracking-wide transition disabled:cursor-default disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

const FIELD = 'h-11 w-full border-0 border-b border-muted/50 bg-transparent px-0 text-text outline-none transition focus:border-gold'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD} [&>option]:bg-surface-high ${className}`} {...props} />
}

export function Overline({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11px] font-medium uppercase tracking-[0.12em] text-muted ${className}`}>{children}</p>
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-surface-low p-6 sm:p-8 ${className}`}>{children}</section>
}

export function Alert({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  const color = tone === 'error' ? 'border-loss text-loss' : 'border-gold text-text'
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`border-l-2 bg-surface-high px-4 py-3 text-sm ${color}`}>
      {children}
    </p>
  )
}
