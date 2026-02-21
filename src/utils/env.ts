// src/utils/env.ts
import { join } from 'path'

export const root = join(import.meta.dir, '../../')
const distPath = join(root, 'dist')

export const versionPath = join(distPath, 'Version.txt')
export const defsPath = join(distPath, 'assets/Xmls') // 存放骑砍 XML 的地方
export const sourcePath = join(distPath, 'assets/Source')
export const dbPath = join(distPath, 'bannerlord.db') // 统一使用一个数据库