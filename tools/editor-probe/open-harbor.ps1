param([string]$SessionPath=(Join-Path $PSScriptRoot '..\..\dist\editor-probe\harbor-demo\session.json'))
$ErrorActionPreference='Stop'
$taskRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskSceneName='bannersage_agent_harbor'
$taskSessionPath=[IO.Path]::GetFullPath($SessionPath)
$taskExpectedSession=Join-Path $taskRepo 'dist\editor-probe\harbor-demo\session.json'
if($taskSessionPath -ne $taskExpectedSession){throw 'Only the prepared harbor session is supported.'}
$taskConfig=Get-Content -LiteralPath $taskSessionPath -Raw | ConvertFrom-Json
$taskGame=[IO.Path]::GetFullPath($taskConfig.gameDir)
$taskRuntime=Join-Path $taskRepo 'dist\editor-probe\runtime'
$taskOutput=Join-Path $taskRepo 'dist\editor-probe\harbor-demo'
$taskPhysicalModule=Join-Path $taskGame 'Modules\BannerlordSage.EditorProbe'
$taskAliasModule=Join-Path $taskRuntime 'Modules\BannerlordSage.EditorProbe'
$taskSceneDir=Join-Path $taskAliasModule ('SceneObj\'+$taskSceneName)
if($taskConfig.sceneName -ne $taskSceneName -or
   [IO.Path]::GetFullPath($taskConfig.sceneDir) -ne $taskSceneDir -or
   [IO.Path]::GetFullPath($taskConfig.outputDir) -ne $taskOutput -or
   $taskConfig.port -ne 17748 -or [string]::IsNullOrWhiteSpace($taskConfig.token)){
    throw 'The prepared harbor session has unexpected paths or settings.'
}
$taskModuleLink=Get-Item -LiteralPath $taskAliasModule -Force
if($taskModuleLink.LinkType -ne 'Junction' -or
   [IO.Path]::GetFullPath([string]($taskModuleLink.Target | Select-Object -First 1)) -ne $taskPhysicalModule){
    throw 'The isolated runtime does not point at the prepared probe module.'
}
foreach($taskVariant in @('Win64_Shipping_Client','Win64_Shipping_wEditor')){
    $taskVersion=New-Object Xml.XmlDocument
    $taskVersion.Load((Join-Path $taskGame ('bin\'+$taskVariant+'\Version.xml')))
    if($taskVersion.SelectSingleNode('//Singleplayer').GetAttribute('Value') -ne 'v1.4.8'){
        throw 'The harbor sample requires the aligned v1.4.8 game and editor.'
    }
}
$taskSceneXml=New-Object Xml.XmlDocument
$taskSceneXml.Load((Join-Path $taskSceneDir 'scene.xscene'))
if($taskSceneXml.DocumentElement.GetAttribute('name') -ne $taskSceneName){throw 'Unexpected harbor scene identity.'}
$taskExe=Join-Path $taskRuntime 'bin\Win64_Shipping_wEditor\Bannerlord.exe'
$taskBinLink=Get-Item -LiteralPath (Split-Path $taskExe) -Force
if($taskBinLink.LinkType -ne 'Junction' -or
   [IO.Path]::GetFullPath([string]($taskBinLink.Target | Select-Object -First 1)) -ne (Join-Path $taskGame 'bin\Win64_Shipping_wEditor')){
    throw 'The isolated editor binary junction has an unexpected target.'
}
$taskBun=(Get-Command bun -ErrorAction Stop).Source
$taskProcessPath=Join-Path $taskOutput 'process.json'
$taskProcess=$null
$taskFreshLaunch=$false
if(Test-Path -LiteralPath $taskProcessPath){
    $taskRecord=Get-Content -LiteralPath $taskProcessPath -Raw | ConvertFrom-Json
    $taskCandidate=Get-Process -Id $taskRecord.pid -ErrorAction SilentlyContinue
    if($taskCandidate -and $taskCandidate.Path -eq $taskExe){$taskProcess=$taskCandidate}
}
if(-not $taskProcess){
    if(Get-Process -Name Bannerlord -ErrorAction SilentlyContinue){
        throw 'A Bannerlord process is already running. Preserve or close that session before launching the harbor editor.'
    }
    $taskEnv=@{
        BANNERSAGE_EDITOR_PROBE_TOKEN=[string]$taskConfig.token
        BANNERSAGE_EDITOR_PROBE_PORT=[string]$taskConfig.port
        BANNERSAGE_EDITOR_PROBE_SCENE_DIR=$taskSceneDir
        BANNERSAGE_EDITOR_PROBE_SCENE_NAME=$taskSceneName
        BANNERSAGE_EDITOR_PROBE_OUTPUT=$taskOutput
    }
    $taskOldEnv=@{}
    try{
        foreach($taskKey in $taskEnv.Keys){
            $taskOldEnv[$taskKey]=[Environment]::GetEnvironmentVariable($taskKey,'Process')
            [Environment]::SetEnvironmentVariable($taskKey,$taskEnv[$taskKey],'Process')
        }
        $taskProcess=Start-Process -FilePath $taskExe -ArgumentList @('/singleplayer','_MODULES_*Native*BannerlordSage.EditorProbe*_MODULES_') -WorkingDirectory (Split-Path $taskExe) -WindowStyle Normal -PassThru
        $taskFreshLaunch=$true
        @{pid=$taskProcess.Id;exe=$taskExe;workingDirectory=(Split-Path $taskExe);scene=$taskSceneName;visible=$true;startedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $taskProcessPath -Encoding UTF8
    }finally{
        foreach($taskKey in $taskOldEnv.Keys){[Environment]::SetEnvironmentVariable($taskKey,$taskOldEnv[$taskKey],'Process')}
    }
}
$taskOldSession=[Environment]::GetEnvironmentVariable('BANNERSAGE_EDITOR_PROBE_SESSION','Process')
function Invoke-HarborAction([string]$Action){
    $taskReplyText= & $taskBun run (Join-Path $PSScriptRoot 'probe.ts') call $Action
    if($LASTEXITCODE -ne 0){throw "Editor CLI failed during $Action. Check the visible editor window."}
    $taskReply=($taskReplyText -join "`n") | ConvertFrom-Json
    if(-not $taskReply.ok){throw ('Editor rejected '+$Action+': '+$taskReply.error)}
    return $taskReply
}
try{
    $env:BANNERSAGE_EDITOR_PROBE_SESSION=$taskSessionPath
    $taskReady=$false
    $taskDeadline=[DateTime]::UtcNow.AddSeconds(60)
    while([DateTime]::UtcNow -lt $taskDeadline){
        $taskProcess.Refresh()
        if($taskProcess.HasExited){throw 'The editor exited before its bridge became ready.'}
        $taskSocket=New-Object Net.Sockets.TcpClient
        try{
            $taskConnecting=$taskSocket.ConnectAsync('127.0.0.1',[int]$taskConfig.port)
            if($taskConnecting.Wait(400) -and $taskSocket.Connected){$taskReady=$true;break}
        }catch{}finally{$taskSocket.Dispose()}
        Start-Sleep -Milliseconds 500
    }
    if(-not $taskReady){throw 'Bridge not ready. Check the editor for a startup or Safe Mode dialog, then run this script again.'}
    $taskStatus=Invoke-HarborAction 'status'
    if($taskStatus.result.probeScene -ne $taskSceneName){throw 'The running bridge belongs to another scene.'}
    if($taskStatus.result.editMode -and $taskStatus.result.scene -eq $taskSceneName){
        Write-Output 'Harbor is already open; your current edits are preserved.'
        return
    }
    if(-not $taskFreshLaunch){
        throw 'This existing editor has left the harbor scene. Save your current work and open the harbor from the editor; this script will not replace it.'
    }
    if(-not $taskStatus.result.editMode){$null=Invoke-HarborAction 'enter_editor'}
    $taskDeadline=[DateTime]::UtcNow.AddSeconds(30)
    do{
        Start-Sleep -Milliseconds 400
        $taskStatus=Invoke-HarborAction 'status'
        if([DateTime]::UtcNow -gt $taskDeadline){throw 'Editor entry timed out. Check the visible window.'}
    }while(-not $taskStatus.result.editMode)
    $null=Invoke-HarborAction 'open_scene'
    $taskDeadline=[DateTime]::UtcNow.AddSeconds(30)
    do{
        Start-Sleep -Milliseconds 400
        $taskStatus=Invoke-HarborAction 'status'
        if([DateTime]::UtcNow -gt $taskDeadline){throw 'Harbor did not become active. Check the visible editor window.'}
    }while(-not $taskStatus.result.editMode -or $taskStatus.result.scene -ne $taskSceneName)
    Write-Output ('Harbor opened: '+$taskSceneName+'. The editor remains open.')
}finally{[Environment]::SetEnvironmentVariable('BANNERSAGE_EDITOR_PROBE_SESSION',$taskOldSession,'Process')}
