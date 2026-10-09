param(
    [Parameter(Mandatory=$true)][string]$GameDir,
    [Parameter(Mandatory=$true)][string]$ScenePath,
    [Parameter(Mandatory=$true)][double]$X,
    [Parameter(Mandatory=$true)][double]$Y,
    [Parameter(Mandatory=$true)][double]$Z,
    [Parameter(Mandatory=$true)][double]$TargetX,
    [Parameter(Mandatory=$true)][double]$TargetY,
    [Parameter(Mandatory=$true)][double]$TargetZ
)
$ErrorActionPreference='Stop'
if($GameDir -notmatch '^[a-zA-Z]:[\\/]' -or $ScenePath -notmatch '^[a-zA-Z]:[\\/]'){
    throw 'GameDir and ScenePath must be absolute local Windows paths'
}
$taskGameDir=[System.IO.Path]::GetFullPath($GameDir)
$taskRepoRoot=[System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot,'..','..'))
$taskScenePath=[System.IO.Path]::GetFullPath($ScenePath)
$taskAllowedSceneNames=@('bannersage_agent_camp','bannersage_agent_harbor')
$taskAllowedPaths=foreach($taskSceneName in $taskAllowedSceneNames){
    [System.IO.Path]::Combine($taskGameDir,'Modules','BannerlordSage.EditorProbe','SceneObj',$taskSceneName,'scene.xscene')
    [System.IO.Path]::Combine($taskRepoRoot,'dist','editor-probe','runtime','Modules','BannerlordSage.EditorProbe','SceneObj',$taskSceneName,'scene.xscene')
}
if($taskScenePath -notin $taskAllowedPaths){throw 'Only the dedicated camp or harbor scene is permitted'}
$taskRuntimeModule=[System.IO.Path]::Combine($taskRepoRoot,'dist','editor-probe','runtime','Modules','BannerlordSage.EditorProbe')
if($taskScenePath.StartsWith($taskRuntimeModule+[System.IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
    $taskRuntimeLink=Get-Item -LiteralPath $taskRuntimeModule -Force
    $taskExpectedModule=[System.IO.Path]::Combine($taskGameDir,'Modules','BannerlordSage.EditorProbe')
    $taskRuntimeTarget=[string]($taskRuntimeLink.Target | Select-Object -First 1)
    if($taskRuntimeLink.LinkType -ne 'Junction' -or -not $taskRuntimeTarget -or
       [System.IO.Path]::GetFullPath($taskRuntimeTarget) -ne $taskExpectedModule){
        throw 'The runtime module junction does not match the supplied GameDir'
    }
}
$taskSceneIdentity=[System.IO.Path]::GetFileName([System.IO.Path]::GetDirectoryName($taskScenePath))
foreach($taskValue in @($X,$Y,$Z,$TargetX,$TargetY,$TargetZ)){
    if([double]::IsNaN($taskValue) -or [double]::IsInfinity($taskValue) -or [Math]::Abs($taskValue)>200){throw 'Invalid camera value'}
}
$taskDirection=@(($TargetX-$X),($TargetY-$Y),($TargetZ-$Z))
$taskLength=[Math]::Sqrt(($taskDirection[0]*$taskDirection[0])+($taskDirection[1]*$taskDirection[1])+($taskDirection[2]*$taskDirection[2]))
if($taskLength -lt 0.1){throw 'Camera and target are too close'}
$taskDirection=@($taskDirection | ForEach-Object {$_/$taskLength})
$taskInvariant=[Globalization.CultureInfo]::InvariantCulture
function Format-TaskNumber([double]$Value){return $Value.ToString('0.000000',$taskInvariant)}
$taskXml=New-Object System.Xml.XmlDocument
$taskXml.PreserveWhitespace=$true
$taskXml.Load($taskScenePath)
if($taskXml.DocumentElement.GetAttribute('name') -cne $taskSceneIdentity){throw 'Unexpected scene identity'}
$taskEditor=$taskXml.SelectSingleNode('/scene/editor_data')
if(-not $taskEditor){throw 'Missing editor camera data'}
$taskEditor.SetAttribute('editor_camera_position',(@($X,$Y,$Z) | ForEach-Object {Format-TaskNumber $_}) -join ', ')
$taskEditor.SetAttribute('editor_camera_forward',($taskDirection | ForEach-Object {Format-TaskNumber $_}) -join ', ')
$taskEditor.SetAttribute('editor_camera_elevation',(Format-TaskNumber ([Math]::Asin($taskDirection[2]))))
$taskEditor.SetAttribute('editor_camera_bearing',(Format-TaskNumber ([Math]::Atan2($taskDirection[0],$taskDirection[1]))))
$taskSettings=New-Object System.Xml.XmlWriterSettings
$taskSettings.Encoding=New-Object System.Text.UTF8Encoding($false)
$taskSettings.NewLineHandling=[System.Xml.NewLineHandling]::None
$taskWriter=[System.Xml.XmlWriter]::Create($taskScenePath,$taskSettings)
try{$taskXml.Save($taskWriter)}finally{$taskWriter.Dispose()}
@{scene=$taskSceneIdentity;cameraSource='saved_scene_metadata';position=@($X,$Y,$Z);target=@($TargetX,$TargetY,$TargetZ)} | ConvertTo-Json -Compress
