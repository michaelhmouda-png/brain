param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
$pointerPath = Join-Path $root 'current.json'
$statusPath = Join-Path $root 'status.json'

function Write-SafeStatus([string]$state,[string]$code,[int]$restartCount) {
  $temporary = "$statusPath.tmp"
  [pscustomobject]@{ state=$state; code=$code; observedAt=[DateTimeOffset]::UtcNow.ToString('o'); restartCount=$restartCount } |
    ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $statusPath -Force
}

$restarts = 0
while ($true) {
  try {
    $pointer = Get-Content -Raw -LiteralPath $pointerPath | ConvertFrom-Json
    $release = [IO.Path]::GetFullPath((Join-Path $root ([string]$pointer.currentRelease)))
    if (-not $release.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'AGENT_RELEASE_BOUNDARY_INVALID' }
    $cli = Join-Path $release 'agent\src\cli.ts'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'AGENT_RELEASE_INVALID' }
    Write-SafeStatus 'starting' 'AGENT_STARTING' $restarts
    $process = Start-Process -FilePath 'node.exe' -ArgumentList @('--experimental-strip-types',$cli,'start') -WorkingDirectory $release -WindowStyle Hidden -PassThru -Wait
    $code = if ($process.ExitCode -eq 0) { 'AGENT_STOPPED' } else { 'AGENT_PROCESS_FAILED' }
  } catch { $code = if ($_.Exception.Message -match '^AGENT_[A-Z0-9_]+$') { $_.Exception.Message } else { 'AGENT_SUPERVISOR_FAILED' } }
  $restarts++
  Write-SafeStatus 'recovering' $code $restarts
  Start-Sleep -Seconds ([Math]::Min(60,[Math]::Pow(2,[Math]::Min($restarts,5))))
}
