const PROBE_ORIGIN = 'http://same-site.invalid'

/**
 * Only same-site paths are allowed as redirect targets after login links. The value is parsed the
 * way the redirect will parse it (URL parsing drops tabs and line breaks), so tricks such as
 * "/\t/evil.com" cannot turn it into another site.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/')) return fallback
  let url: URL
  try {
    url = new URL(next, PROBE_ORIGIN)
  } catch {
    return fallback
  }
  if (url.origin !== PROBE_ORIGIN) return fallback
  // "/.//evil.com" parses to the path "//evil.com", which a redirect reads as another site.
  if (url.pathname.startsWith('//') || url.pathname.startsWith('/\\')) return fallback
  return `${url.pathname}${url.search}${url.hash}`
}
