import type { Db } from './client.ts'
import { instance } from './schema/instance.ts'

/**
 * The minimum a fresh database needs to be a Portta: an identity row.
 *
 * Nothing else. There is no example content to insert.
 */
export function seedMinimal(db: Db, name = 'portta'): void {
  db.insert(instance).values({ name }).onConflictDoNothing({ target: instance.singleton }).run()
}
