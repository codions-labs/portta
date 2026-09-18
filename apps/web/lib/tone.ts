/**
 * The panel's tones, and the one place their class names live.
 *
 * Every dot, badge, rail and indicator reads its colour from here, so a tone
 * looks the same wherever it appears and a new one is added once.
 */
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'agent'

export const TONES: readonly Tone[] = ['neutral', 'accent', 'ok', 'warn', 'danger', 'info', 'agent']

/** A filled dot, bar or marker. */
export const toneBg: Record<Tone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  agent: 'bg-agent',
}

/** Text or an icon in the tone. */
export const toneText: Record<Tone, string> = {
  neutral: 'text-subtle',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  agent: 'text-agent',
}

/** A soft tint, for a badge or a callout that must not shout. */
export const toneSoft: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent/12 text-accent',
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/14 text-warn',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  agent: 'bg-agent/12 text-agent',
}

/** A hairline in the tone, for a callout's edge. */
export const toneBorder: Record<Tone, string> = {
  neutral: 'border-line',
  accent: 'border-accent/35',
  ok: 'border-ok/35',
  warn: 'border-warn/35',
  danger: 'border-danger/35',
  info: 'border-info/35',
  agent: 'border-agent/35',
}

/** The faintest wash of the tone: the background of a callout. */
export const toneWash: Record<Tone, string> = {
  neutral: 'bg-surface-2/60',
  accent: 'bg-accent/6',
  ok: 'bg-ok/6',
  warn: 'bg-warn/8',
  danger: 'bg-danger/6',
  info: 'bg-info/6',
  agent: 'bg-agent/6',
}

/** A tone from a wider vocabulary (`outline`, an unknown string) as one of ours. */
export function narrowTone(tone: string | null | undefined): Tone {
  return (TONES as readonly string[]).includes(tone ?? '') ? (tone as Tone) : 'neutral'
}
