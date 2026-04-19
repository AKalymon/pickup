#!/usr/bin/env node
'use strict'

const { execSync } = require('child_process')
const { join } = require('path')

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
