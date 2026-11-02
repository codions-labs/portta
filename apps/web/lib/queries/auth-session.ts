'use client'

import { useQuery } from '@tanstack/react-query'
import { authClient } from '../auth-client.ts'
import { keys } from './keys.ts'

/**
 * Both account cards share this request. The vanilla client keeps Better Auth's
 * external server package from importing a second React during Next rendering.
 */
export function useAuthSession() {
  return useQuery({
    queryKey: keys.authSession(),
    queryFn: async () => {
      const { data, error } = await authClient.getSession()
      if (error) throw new Error(error.message)
      return data
    },
    staleTime: 30_000,
  })
}
