export const workspaces = [
  'portta-core',
  'portta-contracts',
  'portta-mcp',
  'portta-db',
  'portta-auth-core',
  '@codions/portta',
  'portta-host',
  'portta-auth',
  'portta-server',
  'portta-web',
]

export function parseOptions(args) {
  let mode, suite, spec, part, selected
  const modes = { '--integration': 'integration', '--release': 'release', '--e2e': 'e2e', '--lint': 'lint' }
  const notices = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') return { mode: 'help', notices }
    if (modes[arg]) {
      if (mode) throw new Error('Choose one validation mode')
      mode = modes[arg]
    } else if (['--suite', '--spec', '--part', '--workspaces'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`)
      if (arg === '--suite') {
        if (suite) throw new Error('Duplicate --suite')
        suite = value
      }
      if (arg === '--spec') {
        if (spec) throw new Error('Duplicate --spec')
        spec = value
      }
      if (arg === '--part') {
        if (part || value !== 'static') throw new Error('--part accepts static once')
        part = value
      }
      if (arg === '--workspaces') {
        if (selected) throw new Error('Duplicate --workspaces')
        selected = value.split(',')
        const unknown = selected.filter((name) => !workspaces.includes(name))
        if (unknown.length) throw new Error(`Unknown workspace: ${unknown.join(', ')}; choose ${workspaces.join(', ')}`)
      }
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!mode) {
    mode = 'integration'
    notices.push('Default: broad integration validation. Ordinary development should use a targeted test.')
  }
  if ((suite || spec) && mode !== 'e2e') throw new Error('--suite/--spec require --e2e')
  if (suite && spec) throw new Error('Choose --suite or --spec')
  if ((part || selected) && mode !== 'integration') throw new Error('--part/--workspaces require --integration')
  if (part && selected) throw new Error('Choose --part or --workspaces')
  return { mode, suite, spec, part, workspaces: selected, notices }
}
