// src/utils/xml-utils.ts
import { file } from 'bun'
import { XMLParser } from 'fast-xml-parser'

// Keep attributes because Bannerlord XML relies heavily on id/name/value metadata.
export const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
})

export async function readXmlTextFile(fullPath: string): Promise<string> {
  const bytes = new Uint8Array(await file(fullPath).arrayBuffer())
  return decodeXmlBytes(bytes)
}

export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return ''
  }

  const encoding = detectXmlEncoding(bytes)
  const text = new TextDecoder(encoding).decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function detectXmlEncoding(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8'
  }

  if (bytes.length >= 4) {
    if (bytes[0] === 0x3c && bytes[1] === 0x00) return 'utf-16le'
    if (bytes[0] === 0x00 && bytes[1] === 0x3c) return 'utf-16be'
  }

  return 'utf-8'
}
