import { changedFiles, selectTests } from './lib/affected.mjs'
import { reportDir, root, runStep } from './lib/execution.mjs'

const args = process.argv.slice(2)
let base,
  execute = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--run') execute = true
  else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('-')) base = args[++i]
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`)
}
const plan = selectTests(root, changedFiles(root, base))
console.log(`Diff: ${base ? `merge-base(HEAD, ${base})` : 'HEAD'} + local changes + untracked files`)
console.log(JSON.stringify(plan, null, 2))
if (execute && plan.gaps.length) {
  console.error('Selection has gaps; no commands executed. Resolve the listed scope explicitly.')
  process.exitCode = 1
} else if (execute) {
  let passed = true
  for (const action of plan.actions) {
    const ok =
      action.kind === 'vitest'
        ? await runStep(
            action.workspace,
            'npm',
            [
              'test',
              `--workspace=${action.workspace}`,
              '--',
              ...(action.project ? ['--project', action.project] : []),
              ...(action.filter ? [action.filter] : []),
            ],
            { vitest: true },
          )
        : action.kind === 'shell'
          ? await runStep(action.path, 'bash', [action.path])
          : await runStep(action.command.join(' '), action.command[0], action.command.slice(1))
    passed = ok && passed
  }
  console.log(`Reports: ${reportDir}`)
  if (plan.recommendations.length)
    console.log('Additional integration checks remain listed above; this run validates only the selected scope.')
  process.exitCode = passed ? 0 : 1
}
