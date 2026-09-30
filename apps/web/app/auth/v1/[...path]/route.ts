import { NextResponse, type NextRequest } from 'next/server'
import { hasInternalToken, INTERNAL_HEADER, isPublicAuthRequest } from '../../../../lib/auth/internal-proxy.ts'
import { getEnv } from '../../../../lib/env.ts'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 64 * 1024
// Client-supplied forwarding headers must not reach GoTrue, and neither must the app's own cookies.
const DROPPED_REQUEST_HEADERS = ['host', 'connection', 'content-length', 'cookie', 'x-forwarded-for', 'sb-forwarded-for', INTERNAL_HEADER]
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']

const notFound = () => new NextResponse('Not found', { status: 404 })

/** Self-host only: forwards the auth API to the GoTrue container so the browser sees one origin. */
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const env = getEnv()
  const target = env.AUTH_PROXY_TARGET
  if (!target || !env.AUTH_JWT_SECRET) return notFound()
  const { path } = await context.params
  const internal = hasInternalToken(request.headers.get(INTERNAL_HEADER), env.AUTH_JWT_SECRET)
  if (!internal && !isPublicAuthRequest(request.method, path)) return notFound()

  const targetOrigin = new URL(target).origin
  const url = new URL(`/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, targetOrigin)
  if (url.origin !== targetOrigin) return notFound()

  const headers = new Headers(request.headers)
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name)
  let body: ArrayBuffer | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer()
    if (body.byteLength > MAX_BODY_BYTES) return new NextResponse('Payload too large', { status: 413 })
  }
  const upstream = await fetch(url, { method: request.method, headers, body, redirect: 'manual' })
  const responseHeaders = new Headers(upstream.headers)
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name)
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT }
