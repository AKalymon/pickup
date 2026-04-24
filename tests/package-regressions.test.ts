import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')

async function readText(relativePath: string): Promise<string> {
  return Bun.file(join(repoRoot, relativePath)).text()
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readText(relativePath)) as T
}

describe('package entrypoint regressions', () => {
  test('root package and wrapper point at src/main.ts', async () => {
    const pkg = await readJson<{
      module: string
      scripts: Record<string, string>
    }>('package.json')
    const wrapper = await readText('bin/pickup.cjs')

    expect(pkg.module).toBe('src/main.ts')
    expect(pkg.scripts.start).toBe('bun run src/main.ts')
    expect(pkg.scripts.compile).toContain('./src/main.ts')
    expect(wrapper).toContain("join(__dirname, '..', 'src', 'main.ts')")
  })
})

describe('macOS packaging regressions', () => {
  test('macOS postinstall clears quarantine without ad-hoc re-signing', async () => {
    const rootPostinstall = await readText('bin/postinstall.cjs')
    const darwinArmPostinstall = await readText('npm/@pickup-cli/darwin-arm64/postinstall.cjs')
    const darwinX64Postinstall = await readText('npm/@pickup-cli/darwin-x64/postinstall.cjs')

    for (const script of [rootPostinstall, darwinArmPostinstall, darwinX64Postinstall]) {
      expect(script).toContain("execFileSync('xattr'")
      expect(script).not.toContain('codesign')
    }
  })

  test('darwin platform packages still ship their quarantine-clearing postinstall hook', async () => {
    const darwinArmPkg = await readJson<{
      files: string[]
      scripts?: Record<string, string>
    }>('npm/@pickup-cli/darwin-arm64/package.json')
    const darwinX64Pkg = await readJson<{
      files: string[]
      scripts?: Record<string, string>
    }>('npm/@pickup-cli/darwin-x64/package.json')

    for (const pkg of [darwinArmPkg, darwinX64Pkg]) {
      expect(pkg.files).toContain('postinstall.cjs')
      expect(pkg.scripts?.postinstall).toBe('node postinstall.cjs')
    }
  })
})
