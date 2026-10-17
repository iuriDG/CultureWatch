import type { ReactNode } from 'react'

/** A link to another page, shown as a small outlined button (with an arrow that slides on hover, unless arrow={false}). */
export function GoLink({ href, children, arrow = true }: { href: string; children: ReactNode; arrow?: boolean }) {
  return (
    <a className="go-link" href={href}>
      {children}
      {arrow && <span className="arrow" aria-hidden="true">→</span>}
    </a>
  )
}
