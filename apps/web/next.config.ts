import path from 'node:path'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@pv/core', '@pv/db', '@pv/market-data'],
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
  // CSV imports may be up to 2 MB (the form adds a little on top).
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
}

export default withNextIntl(config)
