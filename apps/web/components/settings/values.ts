import type { ConfigField } from 'portta-contracts'

/** What the control should show: the draft, the saved value, what is running, or the catalogue default. */
export function displayValue(field: ConfigField, draft: Record<string, string | null>): string {
  const pending = draft[field.key]
  if (pending !== undefined) return pending ?? ''
  if (field.secret) return ''
  return field.effectiveValue ?? field.value ?? field.runtimeValue ?? field.defaultValue ?? ''
}

export function valuesOf(fields: ConfigField[], draft: Record<string, string | null>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    values[field.key] = displayValue(field, draft)
  }
  return values
}

export function fieldByKey(fields: ConfigField[], key: string): ConfigField | undefined {
  return fields.find((field) => field.key === key)
}
