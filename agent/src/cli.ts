import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { clearState, loadState, pairAgent, startAgent } from './runtime.ts';
import { removeNvrCredential, saveNvrCredential } from './storage.ts';

async function hiddenInput(prompt: string, maximumLength: number, allowed: (character: string) => boolean): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') throw new Error('HIDDEN_PAIRING_INPUT_REQUIRED');
  output.write(prompt);
  input.setRawMode(true); input.resume(); input.setEncoding('utf8');
  let value = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string | Buffer) => {
        const text = chunk.toString();
        for (const character of text) {
          if (character === '\u0003') { cleanup(); reject(new Error('PAIRING_CANCELLED')); return; }
          if (character === '\r' || character === '\n') { cleanup(); resolve(value); return; }
          if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
          else if (allowed(character) && value.length < maximumLength) value += character;
        }
      };
      const cleanup = () => { input.off('data', onData); input.setRawMode(false); input.pause(); output.write('\n'); };
      input.on('data', onData);
    });
  } finally { if (input.isRaw) input.setRawMode(false); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hiddenPairingCode = () => hiddenInput('One-time pairing code: ', 32, (character) => /^[0-9a-fA-F]$/.test(character));
const hiddenCredential = (prompt: string, maximumLength: number) =>
  hiddenInput(prompt, maximumLength, (character) => character >= ' ' && character !== '\u007f');

async function main() {
  const command = process.argv[2];
  if (command === 'pair') {
    const rl = createInterface({ input, output });
    let baseUrl: string;
    try { baseUrl = await rl.question('Brain cloud URL: '); } finally { rl.close(); }
    const code = await hiddenPairingCode();
    const result = await pairAgent(baseUrl.trim(), code);
    console.log(`Paired. Gateway ${result.gatewayId}; location ${result.locationId}. Credential stored with Windows DPAPI.`); return;
  }
  if (command === 'start') { console.log('Brain Agent starting outbound heartbeat service.'); await startAgent(); return; }
  if (command === 'status') { const state = await loadState(); console.log(JSON.stringify(state ? { paired: Boolean(state.encryptedCredential && !state.needsRepair), needsRepair: Boolean(state.needsRepair), gatewayId: state.gatewayId ?? null, locationId: state.locationId ?? null, lastHeartbeatAt: state.lastHeartbeatAt ?? null, agentVersion: '0.1.0' } : { paired: false, needsRepair: false }, null, 2)); return; }
  if (command === 'set-nvr-credentials') {
    const nvrConnectionId = process.argv[3];
    if (!nvrConnectionId || !UUID.test(nvrConnectionId)) throw new Error('NVR_CONNECTION_ID_REQUIRED');
    const username = await hiddenCredential('NVR username: ', 128);
    const password = await hiddenCredential('NVR password: ', 256);
    if (!username || !password) throw new Error('NVR_CREDENTIALS_REQUIRED');
    await saveNvrCredential(nvrConnectionId.toLowerCase(), username, password);
    console.log('NVR credentials stored with Windows DPAPI.'); return;
  }
  if (command === 'remove-nvr-credentials') {
    const nvrConnectionId = process.argv[3];
    if (!nvrConnectionId || !UUID.test(nvrConnectionId)) throw new Error('NVR_CONNECTION_ID_REQUIRED');
    await removeNvrCredential(nvrConnectionId.toLowerCase());
    console.log('Local NVR credentials removed.'); return;
  }
  if (command === 'unpair-local') { await clearState(); console.log('Local pairing removed.'); return; }
  throw new Error('Usage: pair | start | status | set-nvr-credentials <nvr-id> | remove-nvr-credentials <nvr-id> | unpair-local');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Agent failed'); process.exitCode = 1; });
