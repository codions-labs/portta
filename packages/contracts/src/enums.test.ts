// The wire schema and the shared table describe the same thing: one is zod for
// the API, the other is the plain union the CLI compiles against. They cannot
// be one declaration without pulling zod into portta-core, so they are held
// together here instead of by a comment.

import { SERVICE_KINDS, TCP_ROUTINGS } from 'portta-core/browser'
import { describe, expect, it } from 'vitest'
import { ServiceKind, TcpRouting } from './index.ts'

describe('the API schema and the shared table describe the same service kinds', () => {
  it('lists the same kinds, in the same order', () => {
    expect(ServiceKind.options).toEqual([...SERVICE_KINDS])
  })

  it('lists the same TCP routing verdicts', () => {
    expect(TcpRouting.options).toEqual([...TCP_ROUTINGS])
  })
})
