import { activeGameId, dbPath, defsPath, sourcePath } from './env'
import { countFilesInDirectory, directoryHasFiles, fileExists } from './bannerlord-setup'
import { getGameProfile } from './game-profiles'

export async function getInitializationReadiness(): Promise<{
  gameId: string
  ready: boolean
  dbExists: boolean
}> {
  const profile = getGameProfile(activeGameId)
  const [sourceReady, xmlReady, dbExists] = await Promise.all([
    profile.requiresSource ? directoryHasFiles(sourcePath) : Promise.resolve(false),
    profile.requiresXml ? directoryHasFiles(defsPath) : Promise.resolve(false),
    fileExists(dbPath),
  ])

  return {
    gameId: activeGameId,
    ready:
      (!profile.requiresSource || sourceReady) &&
      (!profile.requiresXml || xmlReady) &&
      (!profile.requiresDb || dbExists),
    dbExists,
  }
}

export async function getInitializationStatus(): Promise<{
  gameId: string
  ready: boolean
  sourceFiles: number
  xmlFiles: number
  dbExists: boolean
}> {
  const profile = getGameProfile(activeGameId)
  const [sourceFiles, xmlFiles, dbExists] = await Promise.all([
    countFilesInDirectory(sourcePath),
    countFilesInDirectory(defsPath),
    fileExists(dbPath),
  ])

  return {
    gameId: activeGameId,
    ready:
      (!profile.requiresSource || sourceFiles > 0) &&
      (!profile.requiresXml || xmlFiles > 0) &&
      (!profile.requiresDb || dbExists),
    sourceFiles,
    xmlFiles,
    dbExists,
  }
}
