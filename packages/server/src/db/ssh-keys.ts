import { asc, eq } from 'drizzle-orm'
import { type Db, instance, sshKeys } from 'portta-db'

export interface SshKeyRecord {
  id: string
  name: string
  description: string | null
  algorithm: 'ed25519' | 'rsa'
  bits: number | null
  fingerprint: string
  publicKey: string
  origin: 'generated' | 'imported'
  createdAt: Date
}

export type NewSshKeyRecord = Omit<SshKeyRecord, 'createdAt'>

function record(row: typeof sshKeys.$inferSelect): SshKeyRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    algorithm: row.algorithm as SshKeyRecord['algorithm'],
    bits: row.bits,
    fingerprint: row.fingerprint,
    publicKey: row.publicKey,
    origin: row.origin as SshKeyRecord['origin'],
    createdAt: row.createdAt,
  }
}

export class SshKeysRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  private async instanceId(): Promise<string> {
    const [row] = await this.db.select({ id: instance.id }).from(instance).limit(1)
    if (!row) throw new Error('the Portta instance identity is missing')
    return row.id
  }

  async list(): Promise<SshKeyRecord[]> {
    const rows = await this.db
      .select()
      .from(sshKeys)
      .where(eq(sshKeys.instanceId, await this.instanceId()))
      .orderBy(asc(sshKeys.name))
    return rows.map(record)
  }

  async find(id: string): Promise<SshKeyRecord | null> {
    const [row] = await this.db.select().from(sshKeys).where(eq(sshKeys.id, id)).limit(1)
    if (!row || row.instanceId !== (await this.instanceId())) return null
    return record(row)
  }

  async create(input: NewSshKeyRecord): Promise<SshKeyRecord> {
    const [row] = await this.db
      .insert(sshKeys)
      .values({
        ...input,
        instanceId: await this.instanceId(),
      })
      .returning()
    if (!row) throw new Error('SSH key metadata was not stored')
    return record(row)
  }

  async remove(id: string): Promise<SshKeyRecord | null> {
    const existing = await this.find(id)
    if (!existing) return null
    await this.db.delete(sshKeys).where(eq(sshKeys.id, id))
    return existing
  }
}
