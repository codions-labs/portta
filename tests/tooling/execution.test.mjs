import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runStep } from '../lib/execution.mjs'

test('zero executed tests cannot masquerade as validation', async () => {
  const script =
    "const fs=require('node:fs');const p=process.argv.find(x=>x.startsWith('--outputFile=')).slice(13);fs.writeFileSync(p,JSON.stringify({success:true,numPassedTests:0,numFailedTests:0}));"
  assert.equal(await runStep('zero-test fixture', process.execPath, ['-e', script, '--'], { vitest: true }), false)
})
