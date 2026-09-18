#!/usr/bin/env node
// The way back in.
//
// A self-hosted panel has no mail transport, so there is no reset link. What
// there is instead is this: a script that runs on the host that owns the panel,
// inside its container, where the database URL already is. Being able to run it
// means having the machine, which is the same authority the owner had when they
// created the account.
//
// `portta auth reset-password <email>` is what runs it; the password arrives on
// stdin so it is never in a shell history, in `ps`, or in whatever collects
// both. Nothing is printed but the email.

import { readFileSync } from 'node:fs'
import { createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { Database, loadConfig } from 'portta-server'

const email = (process.argv[2] ?? '').trim().toLowerCase()
if (!email) {
  process.stderr.write('usage: reset-password <email>   (the password is read from stdin)\n')
  process.exit(2)
}

const password = readFileSync(0, 'utf8').trim()
if (password.length < 10) {
  process.stderr.write('the password is read from stdin and must be at least 10 characters\n')
  process.exit(2)
}

const config = loadConfig()

const security = resolveSecurityMode(process.env)
if (security.mode !== 'protected') {
  process.stderr.write('this panel does not sign people in, so it has no passwords to reset\n')
  process.exit(1)
}

const db = Database.open(config.databaseFile)
try {
  const auth = createAuth({ db: db.handle, security, hasOwner: () => hasOwner(db.handle) })
  const context = await auth.$context
  const user = await context.internalAdapter.findUserByEmail(email)
  if (!user) {
    process.stderr.write(`no account with the email ${email}\n`)
    process.exit(1)
  }

  // The library's own hashing, so the value matches what sign-in will compute.
  // Reimplementing it here would be a second answer to "is this the password".
  await context.internalAdapter.updatePassword(user.user.id, await context.password.hash(password))
  // Whoever was holding a session opened with the old password is not who this
  // reset is for.
  await context.internalAdapter.deleteUserSessions(user.user.id)
  process.stdout.write(`password set for ${email}; every session of that account was ended\n`)
} finally {
  await db.close()
}
