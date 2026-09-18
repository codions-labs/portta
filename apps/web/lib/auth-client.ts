'use client'

// The browser's half of Better Auth.
//
// Sign-in, sign-out and the second factor are the library's endpoints, called
// through its own client so the cookie handling, the error shapes and the
// two-factor redirect are the ones it documents. Everything Portta decides —
// who may do what, which projects they see — comes from `/api/auth/me` instead,
// because those are Portta's rules and the client plugin does not know them.

import { adminClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  // Same origin, always: the panel serves its own pages and its own API, and a
  // configurable base URL here would only be a way to point a login form at
  // somebody else's host.
  basePath: '/api/auth',
  plugins: [adminClient(), twoFactorClient()],
})

export const { signIn, signOut } = authClient
