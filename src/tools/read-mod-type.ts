import { readLocalModType } from '../utils/local-mod-csharp-index'

export async function readModType(workspaceRoot: string | undefined, typeName: string) {
  return readLocalModType(workspaceRoot, typeName)
}
