import { DEVICE_COMMAND_TRANSPORT_CAPABILITY } from '../../lib/brain-agent/command-contracts.ts';

export const AGENT_VERSION = '0.1.0';
export const CAPABILITIES = ['brain.heartbeat.v1', DEVICE_COMMAND_TRANSPORT_CAPABILITY] as const;
