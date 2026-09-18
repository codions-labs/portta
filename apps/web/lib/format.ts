import type { TFunction } from 'i18next'

type FormatT = TFunction<'common'>

export function uptime(seconds: number | null | undefined, t?: FormatT): string {
  if (seconds === null || seconds === undefined) return '-'
  if (!t) {
    if (seconds < 60) return `${Math.floor(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ${minutes % 60}m`
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  if (seconds < 60) return t('format.seconds', { count: Math.floor(seconds) })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('format.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('format.hoursMinutes', { hours, minutes: minutes % 60 })
  const days = Math.floor(hours / 24)
  return t('format.daysHours', { days, hours: hours % 24 })
}

export function relativeTime(epochSeconds: number | null | undefined, t?: FormatT): string {
  if (!epochSeconds) return '-'
  const delta = Math.floor(Date.now() / 1000) - epochSeconds
  if (delta < 0) return t ? t('format.in', { time: uptime(-delta, t) }) : `in ${uptime(-delta)}`
  return t ? t('format.ago', { time: uptime(delta, t) }) : `${uptime(delta)} ago`
}

export function expiresIn(epochSeconds: number | null | undefined, t?: FormatT): string {
  if (!epochSeconds) return t ? t('format.noExpiry') : 'no expiry'
  const remaining = epochSeconds - Math.floor(Date.now() / 1000)
  if (remaining <= 0) return t ? t('format.expired') : 'expired'
  return t ? t('format.in', { time: uptime(remaining, t) }) : `in ${uptime(remaining)}`
}

export function bytes(value: number | null | undefined, locale = 'en', t?: FormatT): string {
  if (value === null || value === undefined || value <= 0) return '-'
  const unitKeys = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let size = value
  let unit = 0
  while (size >= 1024 && unit < unitKeys.length - 1) {
    size /= 1024
    unit += 1
  }
  const unitLabel = t ? t(`format.bytes.${unitKeys[unit]}` as 'format.bytes.B') : unitKeys[unit]
  const formatted =
    size < 10 && unit > 0
      ? new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(size)
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(size))
  return `${formatted} ${unitLabel}`
}

export function shortId(id: string): string {
  return id.slice(0, 12)
}

/** Registry and digest noise hides the part a human is looking for. */
export function shortImage(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image
  const parts = withoutDigest.split('/')
  return parts.length > 2 ? parts.slice(-2).join('/') : withoutDigest
}
