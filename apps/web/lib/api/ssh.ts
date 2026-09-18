import type { GenerateSshKey, ImportSshKey, SshForge, SshKey, SshKeys, SshTestResult } from 'portta-contracts'
import { request } from './client.ts'

export const sshApi = {
  sshKeys: () => request<SshKeys>('/ssh/keys'),
  generateSshKey: (body: GenerateSshKey) =>
    request<SshKey>('/ssh/keys', { method: 'POST', body: JSON.stringify(body) }),
  importSshKey: (body: ImportSshKey) =>
    request<SshKey>('/ssh/keys/import', { method: 'POST', body: JSON.stringify(body) }),
  removeSshKey: (id: string) => request<{ ok: true; removed: string }>(`/ssh/keys/${id}`, { method: 'DELETE' }),
  testSshKey: (id: string, host: SshForge) =>
    request<SshTestResult>(`/ssh/keys/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ host }),
    }),
}
