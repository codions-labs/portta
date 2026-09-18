// The panel owner `dev --demo` creates, and only `dev --demo`.
//
// A checkout demonstration needs someone to sign in as. Production `up --demo`
// never uses these credentials: a well-known password belongs on a developer
// machine, not on an installation.

export const DEV_DEMO_OWNER = {
  name: 'Admin Demo',
  email: 'admin@admin.com',
  password: 'secret',
} as const
