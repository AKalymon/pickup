#!/usr/bin/env node
'use strict'

const { execSync, execFileSync } = require('child_process')
const { join } = require('path')

// --- macOS: strip quarantine + ad-hoc codesign the platform binary ---
if (process.platform === 'darwin') {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  try {
    const bin = require.resolve(`@pickup-cli/darwin-${arch}/bin/pickup`)
    try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', bin], { stdio: 'ignore' }) } catch {}
    try { execFileSync('codesign', ['--force', '--sign', '-', bin], { stdio: 'ignore' }) } catch {}
  } catch {}
}

// --- Warn when npm global bin isn't in PATH ---
try {
  const globalBin = execSync('npm bin -g', { encoding: 'utf8' }).trim()
  const pathDirs = (process.env.PATH ?? '').split(':')

  if (!pathDirs.includes(globalBin)) {
    console.log(`
╔─────────────────────────────────────────────────────────╗
│  pickup: almost there!                                  │
│                                                         │
│  npm's global bin isn't in your PATH. Add this to       │
│  your shell config (~/.zshrc, ~/.bashrc, etc.):         │
│                                                         │
│    export PATH="${globalBin}:$PATH"                     │
│                                                         │
│  Then restart your terminal or run:                     │
│    source ~/.zshrc                                      │
╚─────────────────────────────────────────────────────────╝
`)
  }
} catch {
  // If we can't check, silently skip
}
