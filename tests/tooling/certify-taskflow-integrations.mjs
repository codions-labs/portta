import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fail(message) {
  throw new Error(message)
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) fail(`${name} is required for the selected live certification`)
  return value
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: process.env })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout.trim()
}

async function linearGraphql(apiKey, query, variables) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json()
  if (!response.ok || body.errors?.length) fail(`Linear API failed: ${JSON.stringify(body.errors ?? body)}`)
  return body.data
}

async function certifyGitHub(runId) {
  const repo = required('PORTTA_FLOW_E2E_GITHUB_REPO')
  const base = required('PORTTA_FLOW_E2E_GITHUB_BASE')
  const branch = `taskflow-certification/${runId}`
  let prUrl = null
  try {
    const sha = run('gh', ['api', `repos/${repo}/git/ref/heads/${base}`, '--jq', '.object.sha'])
    run('gh', ['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`])
    run('gh', [
      'api',
      '-X',
      'PUT',
      `repos/${repo}/contents/.portta-certification/${runId}.txt`,
      '-f',
      'message=certify Taskflow GitHub integration',
      '-f',
      `content=${Buffer.from(`Taskflow live certification ${runId}\n`).toString('base64')}`,
      '-f',
      `branch=${branch}`,
    ])
    prUrl = run('gh', [
      'pr',
      'create',
      '--repo',
      repo,
      '--base',
      base,
      '--head',
      branch,
      '--draft',
      '--title',
      `[Taskflow certification] ${runId}`,
      '--body',
      'Temporary resource created by the Taskflow live integration certification.',
    ])
    const state = JSON.parse(run('gh', ['pr', 'view', prUrl, '--json', 'state,isDraft']))
    if (state.state !== 'OPEN' || state.isDraft !== true) fail('GitHub draft PR did not reach the expected state')
    console.log(`✓ GitHub: created and verified ${prUrl}`)
  } finally {
    if (prUrl) run('gh', ['pr', 'close', prUrl, '--delete-branch'])
    else spawnSync('gh', ['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`], { env: process.env })
  }
}

async function certifyLinear(runId) {
  const apiKey = required('LINEAR_API_KEY')
  const teamKey = required('PORTTA_FLOW_E2E_LINEAR_TEAM')
  let issueId = null
  try {
    const teams = await linearGraphql(
      apiKey,
      'query CertificationTeam($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key } } }',
      { key: teamKey },
    )
    const teamId = teams.teams.nodes[0]?.id
    if (!teamId) fail(`Linear team ${teamKey} was not found`)
    const created = await linearGraphql(
      apiKey,
      'mutation CertificationIssue($teamId: String!, $title: String!, $description: String!) { issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { id identifier url } } }',
      {
        teamId,
        title: `[Taskflow certification] ${runId}`,
        description: 'Temporary issue created by the Taskflow live integration certification.',
      },
    )
    if (!created.issueCreate.success || !created.issueCreate.issue) fail('Linear issue creation failed')
    issueId = created.issueCreate.issue.id
    await linearGraphql(
      apiKey,
      'mutation CertificationComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } } }',
      { issueId, body: `Taskflow normalized conversation certification ${runId}` },
    )
    const fetched = await linearGraphql(
      apiKey,
      'query CertificationIssueRead($id: String!) { issue(id: $id) { id identifier comments(first: 10) { nodes { body } } } }',
      { id: issueId },
    )
    if (!fetched.issue?.comments.nodes.some((comment) => comment.body.includes(runId))) {
      fail('Linear certification comment could not be read back')
    }
    console.log(`✓ Linear: created and verified ${created.issueCreate.issue.identifier}`)
  } finally {
    if (issueId) {
      await linearGraphql(apiKey, 'mutation CertificationCleanup($id: String!) { issueArchive(id: $id) { success } }', {
        id: issueId,
      })
    }
  }
}

async function certifyDocker(runId) {
  const image = required('PORTTA_FLOW_E2E_DOCKER_IMAGE')
  const agent = process.env.PORTTA_FLOW_E2E_DOCKER_AGENT?.trim() || 'codex'
  const temp = await mkdtemp(join(tmpdir(), 'taskflow-docker-certification-'))
  try {
    await writeFile(join(temp, 'host.txt'), runId)
    run('docker', ['image', 'inspect', image])
    const output = run('docker', [
      'run',
      '--rm',
      '--entrypoint',
      '/bin/sh',
      '-v',
      `${temp}:/certification`,
      image,
      '-lc',
      `test "$(cat /certification/host.txt)" = "${runId}" && command -v ${agent}`,
    ])
    if (!output) fail(`${agent} was not found in Docker image ${image}`)
    console.log(`✓ Docker: verified mount and ${agent} in ${image}`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function selectedTargets() {
  const raw = process.env.PORTTA_FLOW_LIVE_TARGETS?.trim() || 'github,linear,docker'
  const targets = [
    ...new Set(
      raw
        .split(',')
        .map((target) => target.trim())
        .filter(Boolean),
    ),
  ]
  for (const target of targets) {
    if (!['github', 'linear', 'docker'].includes(target)) fail(`Unknown live certification target: ${target}`)
  }
  return targets
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'PORTTA_FLOW_LIVE_E2E=1 PORTTA_FLOW_LIVE_TARGETS=github,linear,docker node tests/tooling/certify-taskflow-integrations.mjs',
    )
    return
  }
  if (process.env.PORTTA_FLOW_LIVE_E2E !== '1') fail('Refusing external mutations without PORTTA_FLOW_LIVE_E2E=1')
  const runId = `${Date.now()}-${process.pid}`
  for (const target of selectedTargets()) {
    if (target === 'github') await certifyGitHub(runId)
    if (target === 'linear') await certifyLinear(runId)
    if (target === 'docker') await certifyDocker(runId)
  }
}

await main()
