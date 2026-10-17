import type { ReactNode } from 'react'

/** A link to another page, shown as a small outlined button with an arrow that slides on hover. */
export function GoLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="go-link" href={href}>
      {children}
      <span className="arrow" aria-hidden="true">→</span>
    </a>
  )
}
