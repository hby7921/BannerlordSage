import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { QUERY_FIRST_BANNERLORD_TOOL_NAMES, AUTHORING_BANNERLORD_TOOL_NAMES } from './bannerlord-toolset'

describe('editor integration into the real BannerlordSage server', () => {
  for (const mode of ['query-first', 'full'] as const) {
    test(`${mode} registers only the expected upstream tools plus editor preview`, async () => {
      // server.ts freezes mode on import. Separate processes exercise both real registries.
      const script = `
        process.env.BANNERSAGE_GAME='bannerlord';
        process.env.BANNERSAGE_TOOLSET='${mode}';
        delete process.env.BANNERSAGE_EDITOR_PROBE_SESSION;
        const {server}=await import('./src/server.ts');
        const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
        const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
        const [ct,st]=InMemoryTransport.createLinkedPair();
        const client=new Client({name:'registry-test',version:'0.0.1'});
        await server.connect(st); await client.connect(ct);
        try {
          const names=(await client.listTools()).tools.map(x=>x.name).sort();
          const result=await client.callTool({name:'bannerlord_editor_status',arguments:{}});
          const text=result.content.find(x=>x.type==='text');
          console.log(JSON.stringify({names,status:JSON.parse(text.text)}));
        } finally {await client.close(); await server.close();}
      `
      const proc = Bun.spawn([process.execPath, '-e', script], {
        cwd: resolve(import.meta.dir, '../..'),
        stdout: 'pipe', stderr: 'pipe',
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ])
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
      const result = JSON.parse(stdout)
      const expected = [...QUERY_FIRST_BANNERLORD_TOOL_NAMES, ...(mode === 'full' ? AUTHORING_BANNERLORD_TOOL_NAMES : [])].sort()
      expect(result.names).toEqual(expected)
      expect(new Set(result.names).size).toBe(result.names.length)
      expect(result.names.length).toBe(mode === 'full' ? 43 : 36)
      expect(result.names.filter((name: string) => name.startsWith('bannerlord_editor_')).length).toBe(mode === 'full' ? 6 : 1)
      expect(result.status.state).toBe('not_configured')
    })
  }
})
