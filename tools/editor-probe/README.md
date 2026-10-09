# Editor MCP preview

**Experimental test version — PRs and issue reports are welcome.** This Windows
preview has been tested with an aligned Bannerlord game and Modding Kit
**v1.4.8**. It is a bounded scene-authoring bridge, not a complete map editor.

The TypeScript/Bun MCP client sends fixed JSON commands over a token-protected
loopback socket. An authored C# `MBSubModuleBase` module queues engine operations
onto `OnApplicationTick`. It references the installed editor assemblies and
calls native scene APIs; it does not replace/rebuild TaleWorlds DLLs, automate
mouse clicks or depend on the TPAC toolkit. The engine must be initialized and
rendering. This repository ships only source and blueprint asset names, never
game DLLs, meshes, textures or saved game scenes.

## Tools and scope

The normal BannerlordSage server uses the same client as the standalone CLI.
Default mode includes `bannerlord_editor_status`; full mode adds:

- `bannerlord_editor_entities`: managed IDs, prefabs, GUIDs and full transforms.
- `bannerlord_editor_prefab_info`: prefab existence and optional mesh bounds.
- `bannerlord_editor_apply_layout`: create/update up to 64 managed roots.
- `bannerlord_editor_save_scene`: save the active dedicated scene.
- `bannerlord_editor_capture`: return the current native PNG screenshot.

Public tools require the configured scene/module and do not open, replace,
reload or close scenes. Layout IDs are stable; updates keep GUIDs and reject
prefab conflicts. Positions are finite and bounded, scales positive, and the
whole batch is prevalidated. A runtime failure is not a transaction: inspect
`partial`, `appliedIds` and `executionMayBeRunning` before retrying. No write is
automatically retried. The transport rejects requests larger than 16,384
characters before sending; split large batches manually. Replies/session files
and screenshot reads are bounded, credentials are redacted, and real paths are
checked against the dedicated module/output folder.

## Local setup

Prerequisites: a legitimate local Bannerlord installation plus Modding Kit,
both v1.4.8; Bun; .NET SDK 8+; and the **.NET Framework 4.7.2 Developer Pack or
Targeting Pack**. The project targets x64/net472 and does not download reference
assemblies automatically. Normal BannerlordSage stdio startup also requires its
usual setup/index initialization; the standalone probe can run independently.

From the repository root:

```powershell
bun install --frozen-lockfile
dotnet build tools/editor-probe/EditorProbe.csproj -c Release '-p:GameDir=<REAL_GAME_DIR>'
bun run tools/editor-probe/probe.ts prepare '<REAL_GAME_DIR>'
```

`<REAL_GAME_DIR>` is your actual local installation. `prepare` creates an ignored
`dist/editor-probe/session.json` with a random local token; it does not deploy a
module, copy assets or start the game. Keep this file private.

1. Create `Modules/BannerlordSage.EditorProbe` under that installation. Copy the
   authored `SubModule.xml` there and the built `BannerlordSage.EditorProbe.dll`
   into **both** `bin/Win64_Shipping_Client` and `bin/Win64_Shipping_wEditor`.
   Do not deploy source or redistribute referenced game assemblies. Close your
   own old bridge instance before replacing its loaded DLL.
2. Make a fresh local scene copy from `Native/SceneObj/scn_new`. Copy only
   `scene.xscene`, `atmosphere.xml`, and `references.txt` into the probe module's
   `SceneObj/bannersage_editor_probe`. Never overwrite an existing authored
   scene. Use an XML parser to change the root scene name to
   `bannersage_editor_probe` and assign a fresh `unique_token`; retain
   `<terrain enabled="false"/>`. These copied game files stay local.
3. Read the session locally, set the bridge environment below, then launch the
   editor build with Native and the probe enabled. The ordinary game executable
   does not provide the required editor API. Leave the window visible.

```powershell
$repo = (Resolve-Path .).Path
$config = Get-Content (Join-Path $repo 'dist/editor-probe/session.json') -Raw | ConvertFrom-Json
$env:BANNERSAGE_EDITOR_PROBE_TOKEN = $config.token
$env:BANNERSAGE_EDITOR_PROBE_PORT = [string]$config.port
$env:BANNERSAGE_EDITOR_PROBE_SCENE_DIR = $config.sceneDir
$env:BANNERSAGE_EDITOR_PROBE_SCENE_NAME = 'bannersage_editor_probe'
$env:BANNERSAGE_EDITOR_PROBE_OUTPUT = $config.outputDir
$editorDir = Join-Path $config.gameDir 'bin/Win64_Shipping_wEditor'
Start-Process -FilePath (Join-Path $editorDir 'Bannerlord.exe') -ArgumentList '/singleplayer','_MODULES_*Native*BannerlordSage.EditorProbe*_MODULES_' -WorkingDirectory $editorDir -WindowStyle Normal
```

Do not print the configuration/token or commit it. When starting through an
isolated runtime (see below), change session.sceneDir to the matching module
junction alias before launching; the native engine's scene resolution and the
bridge's scope must agree.

Enter Editor through its UI, then use the internal CLI to open the dedicated
scene. Writes are guarded to that scene, while the startup placeholder is only
allowed for entry/open. Public tools deliberately do not expose lifecycle calls.

```powershell
bun run tools/editor-probe/probe.ts call status
bun run tools/editor-probe/probe.ts call open_scene
bun run tools/editor-probe/probe.ts mcp-call layout_entities
```

The editor scans physical module metadata even when a module is not enabled.
Unrecognized tags in unrelated community modules can cause modal RGL warnings.
For installations affected by this, use an **isolated local working root** under
`dist/editor-probe/runtime`: junction its editor binary directory, Data, GUI,
Shaders, Icons, modding_resources, XmlSchemas and XmlEditor to the real install;
junction only Native and BannerlordSage.EditorProbe under Modules. Launch from
the junction's `bin/Win64_Shipping_wEditor` as the working directory. Verify each
junction target before reuse; do not rewrite other module XML or copy all mods.
No generated runtime folders belong in Git.

## Main MCP configuration

After ordinary BannerlordSage initialization, choose its full entrypoint and
configure the optional local session in your MCP client:

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-full-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true

[mcp_servers.bannerlordsage.env]
BANNERSAGE_EDITOR_PROBE_SESSION = "<ABSOLUTE_LOCAL_SESSION_JSON>"
```

Alternatively pass the optional absolute local `sessionPath` in each editor
tool call. With no configuration, status reports `not_configured`; existing
query tools continue to work. Reconnect the MCP service after changing its
environment/entrypoint. The editor may remain open. The live editor's installed
version is checked independently of the indexed source dataset.

The separate test surface `bun run tools/editor-probe/probe.ts mcp` exposes one
generic `editor_probe` tool, including internal lifecycle actions. Prefer the
six concrete tools above for normal agent use. Both routes share
`src/utils/bannerlord-editor-client.ts`.

## Blueprint samples

`camp.blueprint.json` defines a 34-root merchant camp; `harbor.blueprint.json`
defines a 55-root dock with Native `ship_a` and `ship_e`. These are layout inputs,
not supplied game assets or playable maps. Prepare independent local scenes
`bannersage_agent_camp` / `bannersage_agent_harbor`, fresh tokens, matching
sceneDir/sceneName process environment and separate ignored session JSON files.
One running bridge is bound to one scene. For the harbor set the copied scene's
water_level=0/water_exists=true, remove the editor ground_plane and use an
outdoor atmosphere; locally copying Native `TOD_12_00_SemiCloudy.xml` and renaming
its atmosphere to `scene_atmosphere` worked in the validation.

```powershell
bun run tools/editor-probe/demo.ts validate tools/editor-probe/camp.blueprint.json
bun run tools/editor-probe/demo.ts validate tools/editor-probe/harbor.blueprint.json
$env:BANNERSAGE_EDITOR_PROBE_SESSION = '<ABSOLUTE_LOCAL_HARBOR_SESSION_JSON>'
bun run tools/editor-probe/demo.ts apply tools/editor-probe/harbor.blueprint.json
```

`demo.ts apply` checks prefabs, applies twice, saves/reloads, verifies GUIDs/full
matrices and takes two previews. **Save manual edits before running it.** Its
separate capture mode edits saved camera metadata and reloads; public
`bannerlord_editor_capture` only captures the current view. Direct SceneView
camera assignment was overwritten by the editor, so preset views use the
XML-aware `set-view.ps1` scoped to the two sample scenes and explicit GameDir.
Routine preview reloads do not need CloseScene or process exit.

`open-harbor.ps1` / `.cmd` are convenience entries for an **already prepared**
harbor session at `dist/editor-probe/harbor-demo/session.json` with the runtime
junctions described above. They are not fresh-clone installers. They preserve
an active harbor's unsaved edits, refuse replacing another existing scene/game,
and leave the editor open. All generated assets, credentials and evidence stay
in the user's local install or ignored dist folder.

## Validation and limitations

The original local v1.4.8 validation covered prefab availability, idempotence,
native save/reopen, GUID/full-transform persistence and real MCP images for the
camp and harbor. This isolated public branch additionally checks the existing
GitHub toolset plus six editor tools (default 36/full 43), shared transport/schema
tests, C# build and release smoke. No unrelated local dataset/profile/features
are included in this preview.

```powershell
bun test src/utils/bannerlord-editor-client.test.ts
bun test src/utils/bannerlord-editor-registry.test.ts
bun run smoke:release
```

- Validated: aligned v1.4.8, dedicated module scenes, existing prefabs and no
  terrain. Native entity enumeration also includes invisible engine helpers.
- **Not validated:** terrain authoring/save data, GI baking, headless rendering,
  playable Mission/player entry, navigation, deck collision traversal, sailing,
  custom TPAC/FBX ingestion, generic scene creation, undo and job cancellation.
  Ships in the sample are static props. The scope guard does not automatically
  reject every possible terrain configuration; use the tested no-terrain fixture.
- A native screenshot once returned a valid but black PNG; raising the existing
  editor window restored a rendered image. Renderer-state cause is not isolated.
  Keep the viewport rendering and inspect content; PNG validity/size/byte equality
  alone do not prove an informative capture. Public capture does not raise UI.
- Editor preview/helper graphics can remain visible; these are not final artwork.
  A stalled native action may outlive a client timeout. Set an MCP call timeout
  of at least 90 seconds if needed and inspect state before retrying writes.

Please contribute narrowly scoped PRs with real-engine validation and clear
version/claim boundaries. Terrain, Mission entry, navigation, reliable preview
diagnostics and ship physics are useful next areas.
