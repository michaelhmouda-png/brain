import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export type StoredNvrCredential = { encryptedUsername: string; encryptedPassword: string };
export type AgentState = {
  publicAgentId: string;
  baseUrl: string;
  encryptedCredential?: string;
  gatewayId?: string;
  locationId?: string;
  lastHeartbeatAt?: string;
  needsRepair?: boolean;
  nvrCredentials?: Record<string, StoredNvrCredential>;
};
const directory = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'HospiBrain') : path.join(homedir(), '.hospibrain');
export const statePath = path.join(directory, 'brain-agent.json');
const PROTECT = `$plain = ($input | Out-String).TrimEnd(); $secure = ConvertTo-SecureString $plain -AsPlainText -Force; ConvertFrom-SecureString $secure`;
const UNPROTECT = `$cipher = ($input | Out-String).Trim(); $secure = ConvertTo-SecureString $cipher; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}`;
const HARDEN_ACL = `$parameters=($input | Out-String | ConvertFrom-Json);$target=[string]$parameters.target;$container=[bool]$parameters.container;$expectedSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$identity=$expectedSid;if($container){$acl=New-Object System.Security.AccessControl.DirectorySecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object System.Security.AccessControl.FileSecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]::None};$acl.SetOwner($identity);$acl.SetAccessRuleProtection($true,$false);$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule);Set-Acl -LiteralPath $target -AclObject $acl;$actual=Get-Acl -LiteralPath $target;$actualOwnerSid=(New-Object System.Security.Principal.NTAccount($actual.Owner)).Translate([System.Security.Principal.SecurityIdentifier]);$rules=@($actual.Access);$ruleSid=if($rules.Count -eq 1){$rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])}else{$null};$full=[System.Security.AccessControl.FileSystemRights]::FullControl;if(-not $actual.AreAccessRulesProtected -or $actualOwnerSid -ne $expectedSid -or $rules.Count -ne 1 -or $ruleSid -ne $expectedSid -or $rules[0].IsInherited -or $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or ($rules[0].FileSystemRights -band $full) -ne $full){exit 23};'ACL_OK'`;

function fixedProcess(program: string, args: string[], input?: string) { return spawnSync(program, args, { input, encoding: 'utf8', shell: false, windowsHide: true }); }
function powershell(script: string, input: string): string { if (process.platform !== 'win32') throw new Error('WINDOWS_DPAPI_REQUIRED'); const result = fixedProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input); if (result.status !== 0 || !result.stdout.trim()) throw new Error('WINDOWS_DPAPI_FAILED'); return result.stdout.trim(); }
function hardenAcl(target: string, container: boolean) {
  const result = fixedProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', HARDEN_ACL], JSON.stringify({ target, container }));
  if (result.status !== 0 || result.stdout.trim() !== 'ACL_OK') throw new Error('WINDOWS_ACL_VERIFICATION_FAILED');
}

export const protectCredential = (credential: string) => powershell(PROTECT, credential);
export const unprotectCredential = (ciphertext: string) => powershell(UNPROTECT, ciphertext);
export async function loadState(): Promise<AgentState | null> { try { return JSON.parse(await readFile(statePath, 'utf8')) as AgentState; } catch { return null; } }
export async function saveState(state: AgentState) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') hardenAcl(directory, true);
  await writeFile(statePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  if (process.platform === 'win32') { try { hardenAcl(statePath, false); } catch (error) { await rm(statePath, { force: true }); throw error; } }
}
export async function clearState() { await rm(statePath, { force: true }); }

export async function saveNvrCredential(nvrConnectionId: string, username: string, password: string) {
  const state = await loadState();
  if (!state?.encryptedCredential || state.needsRepair) throw new Error('REPAIR_REQUIRED');
  const nextCredentials = {
    ...(state.nvrCredentials ?? {}),
    [nvrConnectionId]: {
      encryptedUsername: protectCredential(username),
      encryptedPassword: protectCredential(password),
    },
  };
  await saveState({ ...state, nvrCredentials: nextCredentials });
}

export async function loadNvrCredential(nvrConnectionId: string): Promise<{ username: string; password: string } | null> {
  const state = await loadState();
  const stored = state?.nvrCredentials?.[nvrConnectionId];
  if (!stored) return null;
  return {
    username: unprotectCredential(stored.encryptedUsername),
    password: unprotectCredential(stored.encryptedPassword),
  };
}

export async function removeNvrCredential(nvrConnectionId: string) {
  const state = await loadState();
  if (!state?.nvrCredentials?.[nvrConnectionId]) return false;
  const nextCredentials = { ...state.nvrCredentials };
  delete nextCredentials[nvrConnectionId];
  await saveState({ ...state, nvrCredentials: nextCredentials });
  return true;
}
