// src/utils/xml-utils.ts
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

// 这里的配置极其重要：ignoreAttributes: false 保证了我们能读到骑砍 XML 里的 id="xxx" 等属性
export const parser = new XMLParser({
  ignoreAttributes: false, 
  processEntities: false,
})

export const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
})