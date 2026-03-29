import { getDb } from '../utils/db'
import { getGamePaths } from '../utils/env'
import { readIndexedCsharpType } from '../utils/csharp-type-reader'

export async function readCsharpType(typeName: string) {
  const db = getDb()
  return readIndexedCsharpType({
    db,
    sourcePath: getGamePaths().sourcePath,
    typeName,
  })
}
