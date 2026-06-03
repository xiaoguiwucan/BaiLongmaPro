import { spawnSync } from 'node:child_process'
import electronPath from 'electron'

const args = process.argv.slice(2)
if (!args.length) {
  console.error('Usage: node scripts/run-electron-node.mjs <script.mjs> [...args]')
  process.exit(2)
}

const result = spawnSync(electronPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(typeof result.status === 'number' ? result.status : 1)
