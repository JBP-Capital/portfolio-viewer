import type { Metadata } from 'next'
import { Inter, Manrope } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import type { ReactNode } from 'react'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' })

export const metadata: Metadata = { title: 'Portfolio Viewer', description: 'Your portfolio, valued every day.' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${inter.variable} ${manrope.variable}`}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
