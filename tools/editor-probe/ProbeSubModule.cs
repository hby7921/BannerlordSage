using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TaleWorlds.Engine;
using TaleWorlds.Library;
using TaleWorlds.MountAndBlade;
using Path = System.IO.Path;

namespace BannerlordSage.EditorProbe
{
    // Experimental, bounded bridge: only the copied probe scene may be written.
    public sealed class ProbeSubModule : MBSubModuleBase
    {
        private string ProbeSceneName = "bannersage_editor_probe";
        private const string MarkerName = "bannersage_probe_marker";
        private readonly ConcurrentQueue<Pending> _pending = new ConcurrentQueue<Pending>();
        private TcpListener _listener;
        private volatile bool _running;
        private string _token;
        private string _sceneDirectory;
        private string _logPath;
        private string _outputDirectory;
        private int _mainThread;
        private int _loadThread;
        private long _ticks;
        private const string LayoutTagPrefix = "bannersage_layout_";

        private sealed class Pending
        {
            public JObject Request;
            public int State; // queued=0, executing=1, complete=2, cancelled=3
            public readonly TaskCompletionSource<object> Completion = new TaskCompletionSource<object>();
        }

        private sealed class LayoutApplyException : Exception
        {
            public readonly string[] AppliedIds;
            public LayoutApplyException(Exception cause, IEnumerable<string> appliedIds) : base(cause.Message, cause)
            { AppliedIds = appliedIds.ToArray(); }
        }

        protected override void OnSubModuleLoad()
        {
            base.OnSubModuleLoad();
            _loadThread = Thread.CurrentThread.ManagedThreadId;
            _token = Environment.GetEnvironmentVariable("BANNERSAGE_EDITOR_PROBE_TOKEN");
            _sceneDirectory = Environment.GetEnvironmentVariable("BANNERSAGE_EDITOR_PROBE_SCENE_DIR");
            ProbeSceneName = Environment.GetEnvironmentVariable("BANNERSAGE_EDITOR_PROBE_SCENE_NAME") ?? ProbeSceneName;
            string output = Environment.GetEnvironmentVariable("BANNERSAGE_EDITOR_PROBE_OUTPUT");
            if (string.IsNullOrWhiteSpace(_token) || string.IsNullOrWhiteSpace(_sceneDirectory) || string.IsNullOrWhiteSpace(output))
                return; // Normal launches never start this experimental listener.
            if (!Regex.IsMatch(ProbeSceneName, "^[a-zA-Z][a-zA-Z0-9_]{0,79}$") ||
                Path.GetFileName(_sceneDirectory.TrimEnd('\\', '/')) != ProbeSceneName)
                throw new InvalidOperationException("Scene name must match the dedicated scene directory.");
            Directory.CreateDirectory(output);
            _outputDirectory = Path.GetFullPath(output);
            _logPath = Path.Combine(output, "bridge.log");
            int port = int.Parse(Environment.GetEnvironmentVariable("BANNERSAGE_EDITOR_PROBE_PORT") ?? "17748");
            try
            {
                _listener = new TcpListener(IPAddress.Loopback, port);
                _listener.Start(4);
                _running = true;
                var worker = new Thread(Listen) { IsBackground = true, Name = "BannerlordSage.EditorProbe" };
                worker.Start();
                Log("loaded; loadThread=" + _loadThread + "; editorAssembly=" + typeof(MBEditor).Assembly.Location);
            }
            catch (Exception error) { Log("startup failed: " + error); }
        }

        protected override void OnSubModuleUnloaded()
        {
            _running = false;
            if (_listener != null) _listener.Stop();
            base.OnSubModuleUnloaded();
        }

        protected override void OnApplicationTick(float dt)
        {
            base.OnApplicationTick(dt);
            Interlocked.CompareExchange(ref _mainThread, Thread.CurrentThread.ManagedThreadId, 0);
            Interlocked.Increment(ref _ticks);
            Pending pending;
            if (!_pending.TryDequeue(out pending) || Interlocked.CompareExchange(ref pending.State, 1, 0) != 0) return;
            try
            {
                object value = Execute(pending.Request.Value<string>("action"), pending.Request["args"] as JObject ?? new JObject());
                pending.Completion.TrySetResult(new {
                    ok = true, result = value, mainThread = _mainThread,
                    executedThread = Thread.CurrentThread.ManagedThreadId, loadThread = _loadThread, ticks = _ticks
                });
            }
            catch (Exception error)
            {
                LayoutApplyException partial = error as LayoutApplyException;
                pending.Completion.TrySetResult(new { ok = false, error = error.Message, type = error.GetType().FullName,
                    partial = partial != null, appliedIds = partial == null ? new string[0] : partial.AppliedIds });
                Log("action failed: " + error);
            }
            finally { Interlocked.Exchange(ref pending.State, 2); }
        }

        private void Listen()
        {
            while (_running)
            {
                try
                {
                    using (TcpClient client = _listener.AcceptTcpClient())
                    {
                        client.ReceiveTimeout = 10000;
                        client.SendTimeout = 10000;
                        using (var reader = new StreamReader(client.GetStream(), Encoding.UTF8, false, 4096, true))
                        using (var writer = new StreamWriter(client.GetStream(), new UTF8Encoding(false), 4096, true) { AutoFlush = true })
                        {
                            string line = reader.ReadLine();
                            if (line == null || line.Length > 16384) continue;
                            JObject request = JObject.Parse(line);
                            if (!string.Equals(request.Value<string>("token"), _token, StringComparison.Ordinal))
                            {
                                writer.WriteLine("{\"ok\":false,\"error\":\"Unauthorized\"}");
                                continue;
                            }
                            var pending = new Pending { Request = request };
                            _pending.Enqueue(pending);
                            if (pending.Completion.Task.Wait(TimeSpan.FromSeconds(30)))
                            {
                                JObject response = JObject.FromObject(pending.Completion.Task.Result);
                                if (request.Value<string>("action") == "capture" && response.Value<bool>("ok"))
                                {
                                    try { FinishCapture(response); }
                                    catch (Exception error)
                                    {
                                        response["ok"] = false;
                                        response["error"] = error.Message;
                                        ((JObject)response["result"])["completed"] = false;
                                    }
                                }
                                writer.WriteLine(response.ToString(Formatting.None));
                            }
                            else
                            {
                                bool cancelled = Interlocked.CompareExchange(ref pending.State, 3, 0) == 0;
                                writer.WriteLine(JsonConvert.SerializeObject(new { ok = false, error = "Main-thread request timed out", cancelled, executionMayBeRunning = !cancelled }));
                            }
                        }
                    }
                }
                catch (Exception error) { if (_running) Log("listener: " + error.Message); }
            }
        }

        // Screenshot writing is deferred by the renderer. Decode/convert outside the tick thread.
        private static void FinishCapture(JObject response)
        {
            var result = (JObject)response["result"];
            string bmp = result.Value<string>("path");
            string png = Path.ChangeExtension(bmp, ".png");
            DateTime deadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < deadline)
            {
                try
                {
                    using (System.Drawing.Image image = System.Drawing.Image.FromFile(bmp))
                    {
                        image.Save(png, System.Drawing.Imaging.ImageFormat.Png);
                        result["pngPath"] = png;
                        result["width"] = image.Width;
                        result["height"] = image.Height;
                        result["completed"] = true;
                        return;
                    }
                }
                catch (Exception error) when (error is IOException || error is OutOfMemoryException || error is ArgumentException || error is System.Runtime.InteropServices.ExternalException)
                {
                    Thread.Sleep(200);
                }
            }
            throw new IOException("The renderer did not produce a decodable screenshot within 15 seconds.");
        }

        private object Execute(string action, JObject args)
        {
            if (action == "status") return Status();
            if (action == "enter_editor")
            {
                if (!Utilities.EditModeEnabled) throw new InvalidOperationException("This process has no editor support.");
                if (!MBEditor.IsEditModeOn)
                {
                    AssertNoForeignScene();
                    MBInitialScreenBase.OnEditModeEnterPress();
                }
                return new { requested = true };
            }
            if (action == "open_scene")
            {
                if (!MBEditor.IsEditModeOn) throw new InvalidOperationException("Enter the editor before opening a scene.");
                AssertNoForeignScene(true);
                AssertScenePath();
                return Accepted(MBTestRun.OpenScene(ProbeSceneName), "OpenScene");
            }
            if (action == "close_scene")
            {
                RequireProbeScene();
                return Accepted(MBTestRun.CloseScene(), "CloseScene");
            }
            if (action == "quit")
            {
                AssertNoForeignScene(true);
                Utilities.QuitGame();
                return new { requested = true };
            }
            Scene scene = RequireProbeScene();
            if (action == "layout_entities")
            {
                var managed = GetEntities(scene).Where(x => x.Tags.Any(t => t.StartsWith(LayoutTagPrefix, StringComparison.Ordinal))).ToList();
                return new { count = managed.Count, entities = managed.Select(LayoutEntityInfo).ToArray() };
            }
            if (action == "apply_layout") return ApplyLayout(scene, args);
            if (action == "prefab_info")
            {
                string prefab = args.Value<string>("prefab");
                string meshName = args.Value<string>("mesh") ?? prefab;
                if (string.IsNullOrWhiteSpace(prefab)) throw new InvalidOperationException("Missing prefab name.");
                MetaMesh mesh = MetaMesh.GetCopy(meshName, false, true);
                if (mesh == null) return new { exists = GameEntity.PrefabExists(prefab), mesh = meshName, boundsAvailable = false };
                BoundingBox bounds = mesh.GetBoundingBox();
                return new { exists = GameEntity.PrefabExists(prefab), mesh = meshName, boundsAvailable = true,
                    min = new [] {bounds.min.x,bounds.min.y,bounds.min.z}, max = new [] {bounds.max.x,bounds.max.y,bounds.max.z},
                    size = new [] {bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y,bounds.max.z-bounds.min.z} };
            }
            if (action == "focus")
            {
                Vec3 position = new Vec3(args.Value<float?>("x") ?? 0, args.Value<float?>("y") ?? 0, args.Value<float?>("z") ?? 0);
                if (!Finite(position.x) || !Finite(position.y) || !Finite(position.z) || Math.Abs(position.x)>200 || Math.Abs(position.y)>200 || Math.Abs(position.z)>200)
                    throw new InvalidOperationException("Invalid focus coordinates.");
                MBEditor.ZoomToPosition(position);
                return new { requested = true };
            }
            if (action == "camera")
            {
                Vec3 position = new Vec3(args.Value<float?>("x") ?? 25, args.Value<float?>("y") ?? -30, args.Value<float?>("z") ?? 22);
                Vec3 target = new Vec3(args.Value<float?>("targetX") ?? 0, args.Value<float?>("targetY") ?? 0, args.Value<float?>("targetZ") ?? 0);
                if (!Finite(position.x) || !Finite(position.y) || !Finite(position.z) || !Finite(target.x) || !Finite(target.y) || !Finite(target.z) ||
                    position.DistanceSquared(target) < 0.01f) throw new InvalidOperationException("Invalid camera coordinates.");
                Vec3 current = scene.LastFinalRenderCameraPosition;
                MBEditor.ApplyDeltaToEditorCamera(position - current);
                MBEditor.GetEditorSceneView().SetAcceptGlobalDebugRenderObjects(false);
                GameEntity probe = scene.FindEntityWithName("envmap_probe");
                if (probe != null) probe.SetVisibilityExcludeParents(false);
                Utilities.SelectEntities(new List<GameEntity>());
                return new { requested = true, cameraControl = "position_only", requestedPosition = new [] {position.x,position.y,position.z} };
            }
            if (action == "capture")
            {
                string path = Path.Combine(_outputDirectory, "scene-capture-" + Guid.NewGuid().ToString("N") + ".bmp");
                Utilities.TakeScreenshot(path);
                return new { requested = true, path, scene = scene.GetName() };
            }
            if (action == "entities")
            {
                var entities = GetEntities(scene);
                return new { count = entities.Count, entities = entities.Take(100).Select(EntityInfo).ToArray() };
            }
            if (action == "place_probe")
            {
                if (GetEntities(scene).Any(x => x.Name == MarkerName)) throw new InvalidOperationException("The marker already exists; use move_probe.");
                string prefab = args.Value<string>("prefab");
                ValidateCoordinates(args);
                if (!string.IsNullOrEmpty(prefab) && !GameEntity.PrefabExists(prefab))
                    throw new InvalidOperationException("The prefab does not exist.");
                GameEntity entity = string.IsNullOrEmpty(prefab)
                    ? GameEntity.CreateEmpty(scene, true, false, false)
                    : GameEntity.Instantiate(scene, prefab, false, false);
                if (entity == null) throw new InvalidOperationException("The prefab could not be instantiated.");
                entity.Name = MarkerName;
                entity.AddTag("bannersage_editor_probe");
                Move(entity, args);
                MBEditor.UpdateSceneTree(true);
                return EntityInfo(entity);
            }
            if (action == "move_probe")
            {
                GameEntity marker = GetEntities(scene).SingleOrDefault(x => x.Name == MarkerName);
                if (marker == null) throw new InvalidOperationException("The marker is missing.");
                Move(marker, args);
                return EntityInfo(marker);
            }
            if (action == "save_scene")
            {
                AssertScenePath();
                return Accepted(MBTestRun.SaveScene(), "SaveScene");
            }
            throw new InvalidOperationException("Unsupported action: " + action);
        }

        private static object Accepted(bool accepted, string operation)
        {
            if (!accepted) throw new InvalidOperationException(operation + " returned false.");
            return new { accepted = true };
        }

        private void AssertNoForeignScene(bool allowEmptyDefault = false)
        {
            Scene scene = MBEditor._editorScene;
            if (allowEmptyDefault && scene != null && scene.GetName() == "__default_new_editor_scene_")
            {
                // The native unsaved startup placeholder contains helper entities.
                // Replacing it never authorizes saving anything under Native.
                if (scene.GetModulePath().Replace('\\', '/').TrimEnd('/') == "$BASE/Modules/Native")
                    return;
            }
            if (scene != null) RequireProbeScene();
        }

        private object Status()
        {
            bool editMode = MBEditor.IsEditModeOn;
            Scene scene = editMode ? MBEditor._editorScene : null;
            return new {
                editorEnabled = Utilities.EditModeEnabled, editMode,
                scene = scene == null ? null : scene.GetName(),
                sceneModule = scene == null ? null : scene.GetModulePath(),
                cameraPosition = scene == null ? null : new [] {scene.LastFinalRenderCameraPosition.x,scene.LastFinalRenderCameraPosition.y,scene.LastFinalRenderCameraPosition.z},
                workingDirectory = Environment.CurrentDirectory,
                resolvedSceneModule = scene == null ? null : ResolveNativePath(scene.GetModulePath()),
                sceneEntities = scene == null ? null : GetEntities(scene).Take(12).Select(x => x.Name).ToArray(),
                resolvedProbeScene = ResolveProbeScene(),
                editorAssembly = typeof(MBEditor).Assembly.Location,
                sceneApi = typeof(Scene).Assembly.Location,
                ticks = _ticks, probeScene = ProbeSceneName
            };
        }

        private string ResolveProbeScene()
        {
            string path;
            return Utilities.TryGetFullFilePathOfScene(ProbeSceneName, out path) ? ResolveNativePath(path) : null;
        }

        private Scene RequireProbeScene()
        {
            Scene scene = MBEditor._editorScene;
            if (!MBEditor.IsEditModeOn || scene == null || scene.GetName() != ProbeSceneName)
                throw new InvalidOperationException("Only the dedicated probe scene may be inspected or modified.");
            AssertScenePath();
            string expectedModule = Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(_sceneDirectory)));
            string actualModule = ResolveNativePath(scene.GetModulePath()).TrimEnd('\\', '/');
            if (!string.Equals(actualModule, expectedModule, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The active scene belongs to another module: " + actualModule);
            return scene;
        }

        private void AssertScenePath()
        {
            string path;
            if (!Utilities.TryGetFullFilePathOfScene(ProbeSceneName, out path))
                throw new InvalidOperationException("The dedicated probe scene is not registered.");
            string expected = Path.GetFullPath(_sceneDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string actual = ResolveNativePath(path);
            if (!actual.StartsWith(expected, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(actual.TrimEnd(Path.DirectorySeparatorChar), expected.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Scene resolution escaped the dedicated test folder: " + actual);
        }

        private static string ResolveNativePath(string path)
        {
            if (path.StartsWith("$BASE/", StringComparison.Ordinal) || path.StartsWith("$BASE\\", StringComparison.Ordinal))
                path = Path.Combine(Path.GetFullPath("../../"), path.Substring(6));
            return Path.GetFullPath(path);
        }

        private static List<GameEntity> GetEntities(Scene scene)
        {
            var entities = new List<GameEntity>();
            scene.GetEntities(ref entities);
            return entities;
        }

        private static void Move(GameEntity entity, JObject args)
        {
            ValidateCoordinates(args);
            float x = args.Value<float?>("x") ?? 3;
            float y = args.Value<float?>("y") ?? 4;
            float z = args.Value<float?>("z") ?? 1;
            MatrixFrame frame = entity.GetFrame();
            frame.origin = new Vec3(x, y, z);
            entity.SetFrame(ref frame);
        }

        private static void ValidateCoordinates(JObject args)
        {
            float x = args.Value<float?>("x") ?? 3;
            float y = args.Value<float?>("y") ?? 4;
            float z = args.Value<float?>("z") ?? 1;
            if (!Finite(x) || !Finite(y) || !Finite(z) || Math.Abs(x) > 20 || Math.Abs(y) > 20 || Math.Abs(z) > 20)
                throw new InvalidOperationException("Probe coordinates must be finite and within +/-20.");
        }

        private static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }

        private object ApplyLayout(Scene scene, JObject args)
        {
            JArray rows = args["entities"] as JArray;
            if (rows == null || rows.Count == 0 || rows.Count > 64) throw new InvalidOperationException("Layout requires 1..64 entities.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var existing = GetEntities(scene).Where(x => x.Tags.Any(t => t.StartsWith(LayoutTagPrefix, StringComparison.Ordinal)))
                .ToDictionary(x => x.Tags.Single(t => t.StartsWith(LayoutTagPrefix, StringComparison.Ordinal)).Substring(LayoutTagPrefix.Length), StringComparer.Ordinal);
            foreach (JObject row in rows)
            {
                string id = row.Value<string>("id");
                string prefab = row.Value<string>("prefab");
                if (id == null || !Regex.IsMatch(id, "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$") || !ids.Add(id)) throw new InvalidOperationException("Invalid or duplicate layout ID.");
                if (string.IsNullOrWhiteSpace(prefab) || !GameEntity.PrefabExists(prefab)) throw new InvalidOperationException("Unavailable prefab: " + prefab);
                BuildLayoutFrame(row);
                GameEntity previous;
                if (existing.TryGetValue(id, out previous) && previous.GetPrefabName() != prefab) throw new InvalidOperationException("Prefab conflict for " + id);
            }
            int created = 0, updated = 0;
            var changed = new List<GameEntity>();
            var appliedIds = new List<string>();
            try
            {
                foreach (JObject row in rows)
                {
                    string id = row.Value<string>("id");
                    GameEntity entity;
                    if (!existing.TryGetValue(id, out entity))
                    {
                        entity = GameEntity.Instantiate(scene, row.Value<string>("prefab"), false, true);
                        if (entity == null) throw new InvalidOperationException("Could not instantiate " + id);
                        appliedIds.Add(id);
                        entity.Name = LayoutTagPrefix + id;
                        entity.AddTag(LayoutTagPrefix + id);
                        created++;
                    }
                    else { appliedIds.Add(id); updated++; }
                    MatrixFrame frame = BuildLayoutFrame(row);
                    entity.SetFrame(ref frame);
                    changed.Add(entity);
                }
                MBEditor.UpdateSceneTree(true);
                return new { count = changed.Count, created, updated, entities = changed.Select(LayoutEntityInfo).ToArray() };
            }
            catch (Exception error) { throw new LayoutApplyException(error, appliedIds); }
        }

        private static MatrixFrame BuildLayoutFrame(JObject row)
        {
            float x=row.Value<float?>("x")??0, y=row.Value<float?>("y")??0, z=row.Value<float?>("z")??0;
            float rx=row.Value<float?>("rx")??0, ry=row.Value<float?>("ry")??0, rz=row.Value<float?>("rz")??0;
            float sx=row.Value<float?>("sx")??1, sy=row.Value<float?>("sy")??1, sz=row.Value<float?>("sz")??1;
            if (!new [] {x,y,z,rx,ry,rz,sx,sy,sz}.All(Finite) || Math.Abs(x)>100 || Math.Abs(y)>100 || Math.Abs(z)>100 ||
                Math.Abs(rx)>3600 || Math.Abs(ry)>3600 || Math.Abs(rz)>3600 || sx<0.05f || sy<0.05f || sz<0.05f || sx>20 || sy>20 || sz>20)
                throw new InvalidOperationException("Layout transform outside bounds.");
            Mat3 rotation = Mat3.Identity;
            rotation.ApplyEulerAngles(new Vec3(rx,ry,rz) * (TaleWorlds.Library.MathF.PI/180f));
            rotation.ApplyScaleLocal(new Vec3(sx,sy,sz));
            return new MatrixFrame(rotation,new Vec3(x,y,z));
        }

        private static object LayoutEntityInfo(GameEntity entity)
        {
            string id = entity.Tags.Single(t => t.StartsWith(LayoutTagPrefix,StringComparison.Ordinal)).Substring(LayoutTagPrefix.Length);
            MatrixFrame frame = entity.GetFrame();
            Mat3 normalized = frame.rotation;
            Vec3 scale = normalized.GetScaleVector();
            normalized.ApplyScaleLocal(new Vec3(1f/scale.x,1f/scale.y,1f/scale.z));
            Vec3 euler = normalized.GetEulerAngles() * (180f/TaleWorlds.Library.MathF.PI);
            return new { id, name=entity.Name, prefab=entity.GetPrefabName(), guid=entity.GetGuid(),
                x=frame.origin.x,y=frame.origin.y,z=frame.origin.z,rx=euler.x,ry=euler.y,rz=euler.z,sx=scale.x,sy=scale.y,sz=scale.z,
                rotation=new [] {frame.rotation.s.x,frame.rotation.s.y,frame.rotation.s.z,frame.rotation.f.x,frame.rotation.f.y,frame.rotation.f.z,frame.rotation.u.x,frame.rotation.u.y,frame.rotation.u.z} };
        }

        private static object EntityInfo(GameEntity entity)
        {
            MatrixFrame frame = entity.GetFrame();
            return new { name = entity.Name, prefab = entity.GetPrefabName(), guid = entity.GetGuid(),
                x = frame.origin.x, y = frame.origin.y, z = frame.origin.z };
        }

        private void Log(string text)
        {
            if (_logPath == null) return;
            ThreadPool.QueueUserWorkItem(_ => {
                try { lock (_pending) File.AppendAllText(_logPath, DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine); }
                catch { }
            });
        }
    }
}
