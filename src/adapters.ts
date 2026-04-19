import { spawnSync as nodeSpawnSync, spawn as nodeSpawn } from 'node:child_process'
import type { FileSystem, ProcessSpawner, WhichLookup, EnvironmentVars } from './ports.ts'

export const bunFileSystem: FileSystem = {
  async readTextFile(path) {
    return Bun.file(path).text()
  },

  async statFile(path) {
    const stat = await Bun.file(path).stat()
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  },

  async globFiles(pattern, cwd) {
    const glob = new Bun.Glob(pattern)
    const files: string[] = []
    try {
      for await (const f of glob.scan({ cwd, onlyFiles: true })) {
        files.push(`${cwd}/${f}`)
      }
    } catch {
      // directory doesn't exist or isn't readable
    }
    return files
  },
}

export const bunSpawner: ProcessSpawner = {
  spawnSync(bin, args, opts) {
    return nodeSpawnSync(bin, args, {
      stdio: (opts?.stdio as any) ?? 'inherit',
      cwd: opts?.cwd,
    })
  },

  spawnDetached(bin, args, opts) {
    const child = nodeSpawn(bin, args, {
      stdio: 'ignore',
      detached: true,
      cwd: opts?.cwd,
    })
    return {
      onError: (cb) => child.on('error', cb),
      unref: () => child.unref(),
    }
  },
}

export const processEnv: EnvironmentVars = {
  get: (key) => process.env[key],
}

export const bunWhich: WhichLookup = {
  isOnPath(bin) {
    const result = nodeSpawnSync('which', [bin], { stdio: 'pipe' })
    return result.status === 0
  },
}
