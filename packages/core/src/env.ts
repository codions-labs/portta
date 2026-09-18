import { randomBytes } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const assignment = /^([ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*)(.*)$/

function parts(raw: string): { value: string; suffix: string; quote: string } {
  const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : ''
  if (quote) {
    let end = 1
    for (; end < raw.length; end++) {
      if (raw[end] === '\\' && (raw[end + 1] === quote || (quote === '"' && raw[end + 1] === '\\'))) {
        end++
        continue
      }
      if (raw[end] === quote) break
    }
    if (end === raw.length || !/^[ \t]*(?:#.*)?$/.test(raw.slice(end + 1))) throw new Error('invalid quoted .env value')
    const value =
      quote === "'"
        ? raw.slice(1, end).replace(/\\'/g, "'")
        : raw
            .slice(1, end)
            .replace(/\\(["\\$nrt])/g, (_match, char: string) => ({ n: '\n', r: '\r', t: '\t' })[char] ?? char)
            .replace(/\$\$/g, '$')
    return { value, suffix: raw.slice(end + 1), quote }
  }
  const match = /^(.*?)([ \t]+#.*|[ \t]*)$/.exec(raw)!
  return { value: match[1]!, suffix: match[2]!, quote: '' }
}

export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = assignment.exec(line)
    if (!match) continue
    const key = match[2]!
    if (values.has(key)) throw new Error(`duplicate .env key: ${key}`)
    values.set(key, parts(match[3]!).value)
  }
  return values
}

function encode(value: string, quote = ''): string {
  // Compose treats backslashes literally inside single quotes. Double quotes
  // support escaping backslashes (including a final one) and $$ is literal $.
  if (value.includes('\\') || quote === '"') {
    return `"${value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, () => '$$')}"`
  }
  if (quote === "'" || /[$\s#'"\\]/.test(value)) return `'${value.replace(/'/g, "\\'")}'`
  return value
}

/** Change a value in place; use template neighbours when the key is absent. */
export function setEnvValue(text: string, key: string, value: string, template = ''): string {
  if (!KEY.test(key)) throw new Error(`refusing to write invalid .env key: ${key}`)
  if (/[\n\r]/.test(value)) throw new Error(`refusing to write a multi-line value for ${key}`)
  const values = parseEnv(text)
  if (values.get(key) === value && values.has(key)) return text
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const index = lines.findIndex((line) => assignment.exec(line)?.[2] === key)
  if (index >= 0) {
    const match = assignment.exec(lines[index]!)!
    const old = parts(match[3]!)
    lines[index] = `${match[1]}${encode(value, old.quote)}${old.suffix}`
    return lines.join(eol)
  }
  const keys = [...parseEnv(template).keys()]
  const position = keys.indexOf(key)
  const block = template.split(/\r?\n/)
  const templateIndex = block.findIndex((line) => assignment.exec(line)?.[2] === key)
  let start = templateIndex
  while (start > 0 && !assignment.test(block[start - 1]!)) start--
  const prefix = templateIndex < 0 ? [] : block.slice(start, templateIndex)
  const newLines = [...prefix, `${key}=${encode(value)}`]
  if (position >= 0) {
    // Prefer the preceding known key: its successor's comments stay attached.
    for (let i = position - 1; i >= 0; i--) {
      const anchor = lines.findIndex((line) => assignment.exec(line)?.[2] === keys[i])
      if (anchor >= 0) {
        lines.splice(anchor + 1, 0, ...newLines)
        return lines.join(eol)
      }
    }
    for (let i = position + 1; i < keys.length; i++) {
      const successor = lines.findIndex((line) => assignment.exec(line)?.[2] === keys[i])
      if (successor >= 0) {
        let anchor = successor
        while (anchor > 0 && !assignment.test(lines[anchor - 1]!)) anchor--
        const existingComments = lines.slice(anchor, successor)
        const alreadyHasHeading =
          prefix.some((line) => line.trim()) &&
          prefix.filter((line) => line.trim()).every((line) => existingComments.includes(line))
        lines.splice(
          alreadyHasHeading ? successor : anchor,
          0,
          ...(alreadyHasHeading ? [`${key}=${encode(value)}`] : newLines),
        )
        return lines.join(eol)
      }
    }
  }
  return `${text}${text && !text.endsWith(eol) ? eol : ''}${newLines.join(eol)}${eol}`
}

export function readEnvFile(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
export function isWritable(path: string): boolean {
  try {
    accessSync(existsSync(path) ? path : dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Keep the inode: .env is a file bind mount in the panel. */
export function writeEnvFile(path: string, text: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) {
    chmodSync(path, 0o600)
    return
  }
  const backupDirectory = join(dirname(path), '.env-lock')
  const backup = join(existsSync(backupDirectory) ? backupDirectory : dirname(path), `.portta-env.${process.pid}.bak`)
  const had = existsSync(path)
  if (had) {
    copyFileSync(path, backup)
    chmodSync(backup, 0o600)
  }
  let recovered = true
  try {
    writeFileSync(path, text, { mode: 0o600 })
    chmodSync(path, 0o600)
  } catch (cause) {
    if (had) {
      try {
        copyFileSync(backup, path)
      } catch {
        recovered = false
      }
    }
    throw cause
  } finally {
    if (recovered && existsSync(backup)) unlinkSync(backup)
  }
}

/** The lock directory is visible to every process that may write the file. */
export function updateEnvFile(path: string, update: (text: string, template: string) => string): void {
  const lockDirectory = join(dirname(path), '.env-lock')
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 })
  const lock = join(lockDirectory, 'writer')
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline)
        throw new Error(
          `configuration is locked: ${lock}; retry, or remove the lock after checking no writer is active`,
        )
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try {
    writeEnvFile(path, update(readEnvFile(path), readEnvFile(join(dirname(path), '.env.example'))))
  } finally {
    rmdirSync(lock)
  }
}

export function patchEnvFile(path: string, values: Record<string, string>): void {
  updateEnvFile(path, (text, template) => {
    let next = text || template
    for (const [key, value] of Object.entries(values)) next = setEnvValue(next, key, value, template)
    return next
  })
}

export function prepareEnvFile(path: string): void {
  updateEnvFile(path, (text, template) => {
    if (!template) throw new Error('missing .env.example for this installation')
    let next = text || template
    const defaults = parseEnv(template)
    const present = parseEnv(next)
    for (const [key, value] of defaults) if (!present.has(key)) next = setEnvValue(next, key, value, template)
    const values = parseEnv(next)
    // The one generated secret. The panel database is a SQLite file, protected
    // by the filesystem rather than by a credential
    // (docs/development/adr/0037-sqlite-is-the-panel-database.md).
    if (!values.get('PORTTA_AUTH_SECRET')) {
      next = setEnvValue(next, 'PORTTA_AUTH_SECRET', randomBytes(32).toString('hex'), template)
    }
    if (typeof process.getuid === 'function') {
      for (const key of ['PORTTA_WEB_USER', 'PORTTA_AUTH_USER']) {
        if (!values.get(key)) next = setEnvValue(next, key, `${process.getuid()}:${process.getgid?.() ?? 0}`, template)
      }
    }
    return next
  })
}

/** Installation values win. Runtime selectors (PATH, PORTTA_ROOT, etc.) survive. */
export function mergeEnvironment(file: Map<string, string>, processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(processEnv)) if (value !== undefined) merged[key] = value
  for (const [key, value] of file) merged[key] = value
  return merged
}
