import { redirect } from 'next/navigation'

/** The panel opens on what is happening, not on a chooser. */
export default function Home() {
  redirect('/overview')
}
