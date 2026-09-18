import { ENV_NAMES } from 'portta-core/taskflow/config'

const DEBUG = process.env[ENV_NAMES.debug] === '1'

function ts(): string {
  return new Date().toISOString().slice(11, 23)
}

/** Strip bearer tokens and control-token env assignments so logs never echo secrets. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(new RegExp(`(${ENV_NAMES.controlToken}=)\\S+`, 'gi'), '$1[REDACTED]')
}

function safe(msg: string): string {
  return redactSecrets(msg)
}

export const log = {
  info(msg: string): void {
    console.log(`[${ts()}] ${safe(msg)}`)
  },
  debug(msg: string): void {
    if (DEBUG) console.log(`[${ts()}] ${safe(msg)}`)
  },
  warn(msg: string): void {
    console.warn(`[${ts()}] ${safe(msg)}`)
  },
  error(msg: string, err?: unknown): void {
    const redacted = safe(msg)
    err !== undefined ? console.error(`[${ts()}] ${redacted}`, err) : console.error(`[${ts()}] ${redacted}`)
  },
}
