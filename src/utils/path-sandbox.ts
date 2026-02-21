// src/utils/path-sandbox.ts
import { join } from 'path'
import { root } from './env'

export class PathSandbox {
  readonly #basePath: string

  constructor(basePath: string) {
    this.#basePath = join(root, basePath)
  }

  validateAndResolve(relativePath: string): string {
    const fullPath = join(this.#basePath, relativePath)

    if (!fullPath.startsWith(this.#basePath)) {
      throw new Error(
        `路径越界检测: "${relativePath}" 试图跳出安全的基础目录`
      )
    }
    return fullPath
  }

  get basePath(): string {
    return this.#basePath
  }
}