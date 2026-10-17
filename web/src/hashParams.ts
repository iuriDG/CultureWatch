// The app's address is #/route?key=value…  The query part makes every view linkable: a search result, a
// filtered antibiogram or a trend can be bookmarked or shared and reopens exactly as it was.

export function readHash(): { route: string; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [route, query = ''] = raw.split('?')
  return { route, params: new URLSearchParams(query) }
}

export function hashFor(route: string, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return `#/${route}${s ? `?${s}` : ''}`
}

/** Update the current address's query without a new history entry or a reload. */
export function replaceHashParams(updates: Record<string, string | null | undefined>): void {
  const { route, params } = readHash()
  for (const [k, v] of Object.entries(updates)) {
    if (v) params.set(k, v)
    else params.delete(k)
  }
  const s = params.toString()
  history.replaceState(null, '', `#/${route}${s ? `?${s}` : ''}`)
}
