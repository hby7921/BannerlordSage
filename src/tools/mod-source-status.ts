import { getLocalModSourceStatus } from '../utils/local-mod-csharp-index'

export async function modSourceStatus(workspaceRoot?: string) {
  return getLocalModSourceStatus(workspaceRoot)
}
