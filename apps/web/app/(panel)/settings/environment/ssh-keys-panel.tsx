'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Upload } from 'lucide-react'
import type { SshAlgorithm, SshForge, SshKey } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Mono, Pre } from '@/components/copy'
import { Empty, ErrorBox, Loading, SectionHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useSshKeys } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

type CreateMode = 'generate' | 'import'

export function SshKeysPanel() {
  const { t } = useTranslation('settings')
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const query = useSshKeys()
  const mayManage = useCan('ssh:manage')
  const [mode, setMode] = useState<CreateMode | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [algorithm, setAlgorithm] = useState<SshAlgorithm>('ed25519')
  const [privateKey, setPrivateKey] = useState('')
  const [removing, setRemoving] = useState<SshKey | null>(null)
  const [host, setHost] = useState<SshForge>('github.com')
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)

  function resetCreate() {
    setMode(null)
    setName('')
    setDescription('')
    setAlgorithm('ed25519')
    setPrivateKey('')
  }

  const create = useMutation({
    mutationFn: async () =>
      mode === 'import'
        ? api.importSshKey({ name, description: description || undefined, privateKey })
        : api.generateSshKey({ name, description: description || undefined, algorithm }),
    onSuccess: async () => {
      resetCreate()
      await queryClient.invalidateQueries({ queryKey: keys.sshKeys() })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.removeSshKey(id),
    onSuccess: async () => {
      setRemoving(null)
      await queryClient.invalidateQueries({ queryKey: keys.sshKeys() })
    },
  })
  const test = useMutation({
    mutationFn: (id: string) => api.testSshKey(id, host),
    onSuccess: (result, id) => setTestResult({ id, ...result }),
  })

  return (
    <section className="space-y-2">
      <SectionHeader
        title={t('ssh.title')}
        description={t('ssh.description')}
        actions={
          mayManage ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setMode('import')}>
                <Upload />
                {t('ssh.import')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setMode('generate')}>
                <Plus />
                {t('ssh.generate')}
              </Button>
            </div>
          ) : undefined
        }
      />
      {query.error ? <ErrorBox error={query.error} /> : null}
      <Card>
        {query.isPending ? (
          <Loading />
        ) : (query.data?.keys.length ?? 0) === 0 ? (
          <Empty icon={KeyRound} title={t('ssh.empty')} hint={t('ssh.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {query.data!.keys.map((key) => (
              <li key={key.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{key.name}</span>
                      <Badge>{key.algorithm === 'rsa' ? `RSA-${key.bits ?? 4096}` : 'ED25519'}</Badge>
                      <Badge tone="neutral">{t(`ssh.origin.${key.origin}`)}</Badge>
                    </div>
                    {key.description ? <p className="text-xs text-muted">{key.description}</p> : null}
                    <div className="mt-1 flex items-center gap-1 text-xs">
                      <Mono kind="sha">{key.fingerprint}</Mono>
                      <CopyButton value={key.fingerprint} />
                      <span className="text-subtle">· {relativeTime(key.createdAt)}</span>
                    </div>
                  </div>
                  {mayManage ? (
                    <div className="flex items-center gap-1">
                      <Select
                        size="sm"
                        value={host}
                        onChange={(event) => setHost(event.target.value as SshForge)}
                        aria-label={t('ssh.forge')}
                      >
                        <option value="github.com">GitHub</option>
                        <option value="gitlab.com">GitLab</option>
                        <option value="bitbucket.org">Bitbucket</option>
                      </Select>
                      <Button
                        size="sm"
                        busy={test.isPending && test.variables === key.id}
                        onClick={() => test.mutate(key.id)}
                      >
                        {t('ssh.test')}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setRemoving(key)}>
                        {t('ssh.remove')}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {testResult?.id === key.id ? (
                  <p className={testResult.ok ? 'text-xs text-ok' : 'text-xs text-danger'}>{testResult.message}</p>
                ) : null}
                {test.error && test.variables === key.id ? <ErrorBox error={test.error} /> : null}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted">{t('ssh.publicKey')}</summary>
                  <div className="relative mt-2">
                    <Pre className="pr-10 whitespace-pre-wrap break-all">{key.publicKey}</Pre>
                    <CopyButton
                      className="absolute top-2 right-2"
                      value={key.publicKey}
                      label={t('ssh.copyPublicKey')}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) resetCreate()
        }}
        title={mode === 'import' ? t('ssh.importTitle') : t('ssh.generateTitle')}
        description={mode === 'import' ? t('ssh.importDescription') : t('ssh.generateDescription')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={resetCreate}>
              {t('ssh.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              busy={create.isPending}
              disabled={!name.trim() || (mode === 'import' && privateKey.length < 64)}
              onClick={() => create.mutate()}
            >
              {mode === 'import' ? t('ssh.import') : t('ssh.generate')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t('ssh.name')} required>
            {(id) => <Input id={id} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label={t('ssh.descriptionLabel')}>
            {(id) => (
              <Input
                id={id}
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
          {mode === 'generate' ? (
            <Field label={t('ssh.algorithm')}>
              {(id) => (
                <Select
                  id={id}
                  className="w-full"
                  value={algorithm}
                  onChange={(event) => setAlgorithm(event.target.value as SshAlgorithm)}
                >
                  <option value="ed25519">ED25519</option>
                  <option value="rsa">RSA-4096</option>
                </Select>
              )}
            </Field>
          ) : null}
          {mode === 'import' ? (
            <Field label={t('ssh.privateKey')} hint={t('ssh.privateKeyHint')} required>
              {(id) => (
                <Textarea
                  id={id}
                  mono
                  rows={10}
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                />
              )}
            </Field>
          ) : null}
          {create.error ? <ErrorBox error={create.error} /> : null}
        </div>
      </Dialog>

      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={() => setRemoving(null)}
          title={t('ssh.removeTitle', { name: removing.name })}
          impact={t('ssh.removeImpact')}
          details={<Mono kind="sha">{removing.fingerprint}</Mono>}
          confirmLabel={t('ssh.remove')}
          requireTyped={removing.name}
          busy={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(removing.id)}
        />
      ) : null}
    </section>
  )
}
