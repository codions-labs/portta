'use client'

// A QR code, drawn in the browser.
//
// The URI it encodes carries the TOTP secret, so it is rendered here rather
// than fetched from anywhere: nothing that would put the secret in a URL, a
// log or a third party's server.

import { toDataURL } from 'qrcode'
import { useEffect, useState } from 'react'

export function QrCode({ value, label }: { value: string; label: string }) {
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 208 })
      .then((url) => {
        if (live) setSource(url)
      })
      .catch(() => {
        if (live) setSource(null)
      })
    return () => {
      live = false
    }
  }, [value])

  return (
    <div className="flex justify-center">
      {source ? (
        // biome-ignore lint/performance/noImgElement: a data: URI drawn in this browser, with nothing for an image optimiser to fetch, resize or cache
        <img src={source} alt={label} width={208} height={208} className="rounded-md border border-line bg-white p-2" />
      ) : (
        <div className="size-52 animate-pulse rounded-md border border-line bg-fill" aria-hidden />
      )}
    </div>
  )
}
