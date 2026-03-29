import { isAbsolute, relative, resolve } from 'node:path'
import { root } from './env'

export class PathSandbox {
  readonly #basePath: string

  constructor(basePath: string) {
    this.#basePath = isAbsolute(basePath) ? resolve(basePath) : resolve(root, basePath)
  }

  validateAndResolve(relativePath: string): string {
    const fullPath = resolve(this.#basePath, relativePath)
    const rel = relative(this.#basePath, fullPath)

    if (rel.startsWith('..')) {
      throw new Error(`Path escapes the sandbox root: "${relativePath}"`)
    }

    return fullPath
  }

  get basePath(): string {
    return this.#basePath
  }
}
