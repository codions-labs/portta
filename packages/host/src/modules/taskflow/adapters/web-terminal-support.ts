import type { MultiplexerKind } from 'portta-core/taskflow'

/** Explicit error when a browser terminal tries to attach under herdr.
 *  herdr has no grouped-session attach; hanging on tmux `new-session -t` would
 *  never complete. */
export const HERDR_WEB_TERMINAL_UNSUPPORTED =
  'The web terminal is not supported with multiplexer: herdr. Attach from your own terminal with `herdr`, or switch the project back to tmux.'

export function webTerminalUnsupportedMessage(multiplexer: MultiplexerKind): string | null {
  return multiplexer === 'herdr' ? HERDR_WEB_TERMINAL_UNSUPPORTED : null
}
