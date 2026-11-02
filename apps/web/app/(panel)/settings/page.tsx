import { notFound, redirect } from 'next/navigation'
import { visibleSections } from '@/components/settings/sections'
import { pagePrincipal, panelSignsPeopleIn } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

/**
 * Settings is not a page; it is a place with sections.
 *
 * Which one somebody lands on depends on what they hold: an owner opens
 * General, a viewer opens their own tokens. Deciding it here rather than
 * defaulting to General means nobody is sent to a section that would answer 404
 * a moment later.
 */
export default async function SettingsIndexPage() {
  const principal = await pagePrincipal()
  const [first] = visibleSections({
    permissions: [...principal.permissions],
    signsPeopleIn: panelSignsPeopleIn(),
  })
  if (!first) notFound()
  redirect(first.href)
}
