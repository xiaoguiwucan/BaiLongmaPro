const fs = require('fs')
const os = require('os')
const path = require('path')
const asar = require('@electron/asar')

const FORCE_PACKAGES = [
  'level-errors',
  'level-codec',
  'level-supports',
  'encoding-down',
  'deferred-leveldown',
  'abstract-leveldown',
  'level-js',
  'levelup',
]

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir
  const resourcesDir = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const asarPath = path.join(resourcesDir, 'app.asar')
  if (!fs.existsSync(asarPath)) return

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-asar-'))
  const unpackedDir = path.join(tmpDir, 'app')
  const repackedPath = path.join(tmpDir, 'app.asar')
  try {
    asar.extractAll(asarPath, unpackedDir)
    const targetNodeModules = path.join(unpackedDir, 'node_modules')
    fs.mkdirSync(targetNodeModules, { recursive: true })

    for (const pkg of FORCE_PACKAGES) {
      const sourceDir = path.join(context.packager.projectDir, 'node_modules', pkg)
      if (!fs.existsSync(sourceDir)) continue
      const targetDir = path.join(targetNodeModules, pkg)
      fs.rmSync(targetDir, { recursive: true, force: true })
      fs.cpSync(sourceDir, targetDir, {
        recursive: true,
        filter: src => !src.includes(`${path.sep}.git${path.sep}`) && !src.includes(`${path.sep}node_modules${path.sep}.cache${path.sep}`),
      })
    }

    await asar.createPackageWithOptions(unpackedDir, repackedPath, {})
    fs.copyFileSync(repackedPath, asarPath)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
