#!/usr/bin/env node
'use strict'

const { execFileSync } = require('child_process')
const { join } = require('path')

if (process.platform !== 'darwin') process.exit(0)

const bin = join(__dirname, 'bin', 'pickup')

try {
  execFileSync('xattr', ['-dr', 'com.apple.quarantine', bin], { stdio: 'ignore' })
} catch { /* attribute may not exist */ }

try {
  execFileSync('codesign', ['--force', '--sign', '-', bin], { stdio: 'ignore' })
} catch { /* codesign unavailable or failed — not fatal */ }
