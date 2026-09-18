import { useEffect, useState } from 'react'

/**
 * Whether nobody has clicked or typed for `timeoutMs`. Polling pauses while the
 * dashboard sits idle in a background window and resumes on the next input.
 */
export function useIdle(timeoutMs: number): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), timeoutMs)
    const onActivity = (): void => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), timeoutMs)
    }
    document.addEventListener('click', onActivity)
    document.addEventListener('keydown', onActivity)
    document.addEventListener('visibilitychange', onActivity)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', onActivity)
      document.removeEventListener('keydown', onActivity)
      document.removeEventListener('visibilitychange', onActivity)
    }
  }, [timeoutMs])

  return idle
}
