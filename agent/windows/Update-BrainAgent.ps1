param(
  [Parameter(Mandatory=$true,ParameterSetName='Update')][string]$ReleaseArchive,
  [Parameter(Mandatory=$true,ParameterSetName='Update')][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory=$true,ParameterSetName='Rollback')][switch]$Rollback,
  [string]$InstallRoot = "$env:ProgramData\HospiBrain\Agent"
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
$pointerPath = Join-Path $root 'current.json'
$pointer = Get-Content -Raw -LiteralPath $pointerPath | ConvertFrom-Json
if ($Rollback) {
  if (-not $pointer.previousRelease) { throw 'AGENT_ROLLBACK_UNAVAILABLE' }
  $next = [pscustomobject]@{ currentRelease=$pointer.previousRelease; previousRelease=$pointer.currentRelease; updatedAt=[DateTimeOffset]::UtcNow.ToString('o') }
} else {
  $archive = [IO.Path]::GetFullPath($ReleaseArchive)
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals([Text.Encoding]::ASCII.GetBytes($actual.ToUpperInvariant()),[Text.Encoding]::ASCII.GetBytes($ExpectedSha256.ToUpperInvariant()))) { throw 'AGENT_ARCHIVE_HASH_MISMATCH' }
  $releaseName = 'releases\' + $actual.ToLowerInvariant()
  $release = [IO.Path]::GetFullPath((Join-Path $root $releaseName))
  if (-not $release.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'AGENT_UPDATE_BOUNDARY_INVALID' }
  New-Item -ItemType Directory -Path $release -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $release -Force
  foreach($required in @('agent\src\cli.ts','agent\windows\BrainAgentSupervisor.ps1')) { if (-not (Test-Path -LiteralPath (Join-Path $release $required) -PathType Leaf)) { throw 'AGENT_ARCHIVE_INVALID' } }
  $next = [pscustomobject]@{ currentRelease=$releaseName; previousRelease=$pointer.currentRelease; updatedAt=[DateTimeOffset]::UtcNow.ToString('o') }
}
$temporary = "$pointerPath.tmp"
$next | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
Stop-ScheduledTask -TaskName 'HospiBrainAgent' -ErrorAction SilentlyContinue
Move-Item -LiteralPath $temporary -Destination $pointerPath -Force
Start-ScheduledTask -TaskName 'HospiBrainAgent'
Start-Sleep -Seconds 10
$info = Get-ScheduledTaskInfo -TaskName 'HospiBrainAgent'
if ($info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009) {
  $pointer | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
  Stop-ScheduledTask -TaskName 'HospiBrainAgent' -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $temporary -Destination $pointerPath -Force
  Start-ScheduledTask -TaskName 'HospiBrainAgent'
  throw 'AGENT_UPDATE_ROLLED_BACK'
}
Write-Output $(if($Rollback){'BRAIN_AGENT_ROLLBACK_COMPLETE'}else{'BRAIN_AGENT_UPDATE_COMPLETE'})
