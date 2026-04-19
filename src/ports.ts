export interface FileSystem {
  readTextFile(path: string): Promise<string>
  statFile(path: string): Promise<{ mtimeMs: number; size: number }>
  globFiles(pattern: string, cwd: string): Promise<string[]>
}

export interface DetachedProcess {
  onError(cb: (err: NodeJS.ErrnoException) => void): void
  unref(): void
}

export interface ProcessSpawner {
  spawnSync(bin: string, args: string[], opts?: { stdio?: string; cwd?: string }): {
    status: number | null
    error?: NodeJS.ErrnoException
  }
  spawnDetached(bin: string, args: string[], opts?: { cwd?: string }): DetachedProcess
}

export interface WhichLookup {
  isOnPath(bin: string): boolean
}

export interface EnvironmentVars {
  get(key: string): string | undefined
}
