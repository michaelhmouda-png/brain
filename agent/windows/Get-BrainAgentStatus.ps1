param([string]$InstallRoot = "$env:ProgramData\HospiBrain\Agent")
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'HospiBrainAgent' -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName 'HospiBrainAgent' -ErrorAction Stop
$statusPath = Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'status.json'
$runtime = if (Test-Path -LiteralPath $statusPath -PathType Leaf) { Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json } else { $null }
[pscustomobject]@{
  installed = $true
  taskState = [string]$task.State
  lastTaskResult = [int]$info.LastTaskResult
  lastRunTime = if($info.LastRunTime -gt [datetime]::MinValue){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null}
  runtimeState = $runtime.state
  runtimeCode = $runtime.code
  observedAt = $runtime.observedAt
  restartCount = $runtime.restartCount
} | ConvertTo-Json
