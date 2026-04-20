#!/usr/bin/env node
'use strict'

// Resolve and execute the platform-specific pre-compiled binary.
// Falls back to running via bun if the platform binary isn't installed
// (e.g. during local development or on an unsupported platform).

const { spawnSync } = require('child_process')
const { join } = require('path')
const { platform, arch } = process

const PLATFORM_PACKAGES = {
  linux:  { x64: '@pickup-cli/linux-x64',  arm64: '@pickup-cli/linux-arm64'  },
  darwin: { x64: '@pickup-cli/darwin-x64', arm64: '@pickup-cli/darwin-arm64' },
  win32:  { x64: '@pickup-cli/win32-x64'                                     },
}

const pkgName = PLATFORM_PACKAGES[platform]?.[arch]

if (pkgName) {
  try {
    const binFile = platform === 'win32' ? 'pickup.exe' : 'pickup'
    const binPath = require.resolve(`${pkgName}/bin/${binFile}`)
    const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' })

    // Gatekeeper or similar security tool killed the binary
    if (result.status === null && !result.error) {
      const binStr = String(binPath)
      console.error(
        '\npickup: the binary was blocked by macOS security (Gatekeeper).\n' +
        'To fix, run:\n\n' +
        `  xattr -dr com.apple.quarantine "${binStr}"\n\n` +
        'Then try pickup again.\n' +
        'For a permanent fix, see: https://github.com/AKalymon/pickup#macos\n'
      )
      process.exit(1)
    }

    process.exit(result.status ?? 0)
  } catch {
    // platform package not installed — fall through to bun fallback
  }
}

// Bun fallback (local dev / unsupported platform)
const cli = join(__dirname, '..', 'src', 'cli.ts')
const result = spawnSync('bun', ['run', cli, ...process.argv.slice(2)], { stdio: 'inherit' })

if (result.error?.code === 'ENOENT') {
  console.error(
    '\npickup: could not find a pre-built binary for your platform and bun is not installed.\n' +
    'Install bun: https://bun.sh\n' +
    'Or download a binary from: https://github.com/AKalymon/pickup/releases\n'
  )
  process.exit(1)
}

process.exit(result.status ?? 0)
