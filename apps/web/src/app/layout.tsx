import type { Metadata, Viewport } from 'next'
import '../styles/global.css'

export const metadata: Metadata = {
  title: {
    default: 'TravelPlus',
    template: '%s · TravelPlus',
  },
  description:
    'Map-first travel planning where every route has been verified against real transit data — and gaps are shown as gaps.',
  applicationName: 'TravelPlus',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block zoom: 200% must remain reachable (A-P5).
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F5F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1116' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..700&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Precedes the map region, per A-O4. */}
        <a className="skip-link" href="#itinerary">
          Skip to itinerary list
        </a>
        {children}
      </body>
    </html>
  )
}
