param(
  [Parameter(Mandatory=$true)][string]$ReleaseArchive,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][PSCredential]$ServiceCredential,
  [string]$InstallRoot = "$env:ProgramData\HospiBrain\Agent"
)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'AGENT_ADMINISTRATOR_REQUIRED' }
$archive = [IO.Path]::GetFullPath($ReleaseArchive)
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'AGENT_ARCHIVE_NOT_FOUND' }
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals([Text.Encoding]::ASCII.GetBytes($actual.ToUpperInvariant()),[Text.Encoding]::ASCII.GetBytes($ExpectedSha256.ToUpperInvariant()))) { throw 'AGENT_ARCHIVE_HASH_MISMATCH' }
$root = [IO.Path]::GetFullPath($InstallRoot)
$releaseName = 'releases\' + $actual.ToLowerInvariant()
$release = [IO.Path]::GetFullPath((Join-Path $root $releaseName))
if (-not $release.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'AGENT_INSTALL_BOUNDARY_INVALID' }
New-Item -ItemType Directory -Path $release -Force | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $release -Force
foreach($required in @('agent\src\cli.ts','agent\windows\BrainAgentSupervisor.ps1')) { if (-not (Test-Path -LiteralPath (Join-Path $release $required) -PathType Leaf)) { throw 'AGENT_ARCHIVE_INVALID' } }
$identity = $ServiceCredential.UserName
& icacls.exe $root '/inheritance:r' '/grant:r' "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'AGENT_ACL_FAILED' }
[pscustomobject]@{ currentRelease=$releaseName; previousRelease=$null; updatedAt=[DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'current.json') -Encoding utf8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy AllSigned -File `"$release\agent\windows\BrainAgentSupervisor.ps1`" -InstallRoot `"$root`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$password = $ServiceCredential.GetNetworkCredential().Password
try { Register-ScheduledTask -TaskName 'HospiBrainAgent' -Action $action -Trigger $trigger -Settings $settings -User $identity -Password $password -RunLevel Highest -Force | Out-Null }
finally { $password = $null }
Start-ScheduledTask -TaskName 'HospiBrainAgent'
Write-Output 'BRAIN_AGENT_INSTALLED'
