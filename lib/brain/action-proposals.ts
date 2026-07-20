import { createHash, randomUUID } from 'crypto';
import type { BrainRequestContext } from './kernel/request-context';
import { ActorContextError } from './kernel/errors.ts';

export const PROPOSAL_SCHEMA_VERSION = 1;
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

export const PROPOSAL_ACTIONS = [
  'create_employee', 'create_task', 'record_inventory_movement',
  'create_shift', 'update_shift', 'delete_shift',
  'create_maintenance_ticket', 'update_maintenance_ticket',
  'delete_maintenance_ticket', 'complete_maintenance_ticket',
  'create_announcement', 'update_announcement', 'delete_announcement',
  'create_incident', 'update_incident', 'delete_incident',
] as const;

export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];
export type ProposalStatus = 'pending' | 'executing' | 'executed' | 'rejected' | 'expired' | 'failed';
export type ProposalRisk = 'medium' | 'high';

interface ProposalIdentity {
  actorId: string;
  profileId: string;
  tenantId: string;
  role: string;
}

function proposalIdentity(context: BrainRequestContext): ProposalIdentity {
  assertRequestContext(context);
  return { actorId: context.actor.actorId, profileId: context.actor.profileId, tenantId: context.tenant.tenantId, role: context.actor.role };
}

function assertRequestContext(context: BrainRequestContext): void {
  if (
    !context ||
    context.tenant.scopeType !== 'company' ||
    context.tenant.tenantId !== context.tenant.companyId ||
    context.tenant.tenantId !== context.actor.companyId
  ) {
    throw new ActorContextError('TENANT_SCOPE_MISMATCH');
  }
}

export interface ProposalRecord {
  id: string;
  actorId: string;
  profileId: string;
  tenantId: string;
  canonicalAction: ProposalAction;
  canonicalPayload: Record<string, unknown>;
  payloadHash: string;
  schemaVersion: number;
  risk: ProposalRisk;
  requiredRole: string | null;
  preview: { label: string; rows: Array<{ key: string; value: string }> };
  status: ProposalStatus;
  correlationId: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
  executedAt: string | null;
  safeResult: string | null;
}

export interface ProposalStore {
  insert(record: ProposalRecord): Promise<void>;
  reject(id: string, identity: ProposalIdentity): Promise<'rejected' | 'not_found' | 'invalid_status'>;
  claim(id: string, identity: ProposalIdentity, now: string): Promise<
    | { outcome: 'claimed'; proposal: ProposalRecord }
    | { outcome: 'executed'; safeResult: string | null }
    | { outcome: 'not_found' | 'expired' | 'invalid_status' }
  >;
  markExecuted(id: string, payloadHash: string, safeResult: string): Promise<void>;
  markFailed(id: string, payloadHash: string, safeErrorCode: string): Promise<void>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = /^\d{4}-\d{2}-\d{2}$/;
const time = /^\d{2}:\d{2}$/;
const relativeDate = /^(today|tomorrow)$/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
  return value as Record<string, unknown>;
}
function string(input: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
  return value.trim();
}
function enumValue(input: Record<string, unknown>, key: string, values: readonly string[], required = false): string | undefined {
  const value = string(input, key, required);
  if (value !== undefined && !values.includes(value)) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
  return value;
}
function uuidValue(input: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = string(input, key, required);
  if (value !== undefined && !uuid.test(value)) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
  return value;
}
function number(input: Record<string, unknown>, key: string, required = false): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (required) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
  return value;
}
function add(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined) target[key] = value;
}

function normalizeTrustedPreviewArguments(action: string, raw: unknown): unknown {
  if (action !== 'create_task') return raw;
  const input = object(raw);
  if (typeof input.priority !== 'string') return input;
  return { ...input, priority: input.priority.trim().toLowerCase() };
}

export function canonicalizeProposalArguments(action: string, raw: unknown): { action: ProposalAction; payload: Record<string, unknown> } {
  if (!PROPOSAL_ACTIONS.includes(action as ProposalAction)) throw new Error('UNSUPPORTED_PROPOSAL_ACTION');
  const a = action as ProposalAction;
  const i = object(raw);
  const p: Record<string, unknown> = {};
  const textKeys: Record<ProposalAction, string[]> = {
    create_employee: ['full_name','job_title','email','phone','notes','hire_date'],
    create_task: ['title','description','assigned_employee_name','urgency','due_date'],
    record_inventory_movement: ['reason'], create_shift: ['notes'], update_shift: ['notes','shift_date'], delete_shift: [],
    create_maintenance_ticket: ['title','description','due_date'], update_maintenance_ticket: ['title','description','due_date'],
    delete_maintenance_ticket: [], complete_maintenance_ticket: ['completion_notes'],
    create_announcement: ['title','content','expires_at'], update_announcement: ['title','content','expires_at'], delete_announcement: [],
    create_incident: ['title','description','affected_area','incident_type'], update_incident: ['title','description','resolution_notes'], delete_incident: [],
  };
  const requiredText = new Set(['create_employee:full_name','create_task:title','create_announcement:title','create_announcement:content','create_incident:title','create_incident:description']);
  for (const key of textKeys[a]) add(p, key, string(i, key, requiredText.has(`${a}:${key}`)));

  const uuidKeys: Record<ProposalAction, string[]> = {
    create_employee:['department_id','location_id'], create_task:['assigned_employee_id'], record_inventory_movement:['inventory_item_id'],
    create_shift:['employee_id','department_id'], update_shift:['shift_id','employee_id'], delete_shift:['shift_id'],
    create_maintenance_ticket:['location_id','assigned_to_id'], update_maintenance_ticket:['ticket_id','assigned_to_id'],
    delete_maintenance_ticket:['ticket_id'], complete_maintenance_ticket:['ticket_id'],
    create_announcement:[], update_announcement:['announcement_id'], delete_announcement:['announcement_id'],
    create_incident:['location_id'], update_incident:['incident_id'], delete_incident:['incident_id'],
  };
  const requiredUuid = new Set(['record_inventory_movement:inventory_item_id','create_shift:employee_id','update_shift:shift_id','delete_shift:shift_id','update_maintenance_ticket:ticket_id','delete_maintenance_ticket:ticket_id','complete_maintenance_ticket:ticket_id','update_announcement:announcement_id','delete_announcement:announcement_id','update_incident:incident_id','delete_incident:incident_id']);
  for (const key of uuidKeys[a]) add(p, key, uuidValue(i, key, requiredUuid.has(`${a}:${key}`)));

  const enumSpecs: Array<[string, readonly string[], boolean]> = [
    ['role',['employee','manager'],a==='create_employee'],
    ['priority', a.includes('announcement') ? ['low','normal','high','urgent'] : ['low','medium','high','critical'], a==='create_task'||a.includes('maintenance')||a.includes('announcement')],
    ['status', a.includes('shift') ? ['scheduled','completed','cancelled'] : a.includes('maintenance') ? ['open','in_progress','completed','cancelled'] : a.includes('incident') ? ['open','investigating','resolved','closed'] : ['pending','in_progress','completed','cancelled'], a==='create_task'||a==='update_shift'||a==='update_maintenance_ticket'||a==='update_incident'],
    ['movement_type',['purchase','usage','waste','adjustment','transfer'],a==='record_inventory_movement'],
    ['shift_type',['morning','afternoon','evening','night','custom'],a==='create_shift'||a==='update_shift'],
    ['severity',['low','medium','high','critical'],a==='create_incident'||a==='update_incident'],
  ];
  for (const [key, values, applicable] of enumSpecs) if (applicable && i[key] !== undefined) add(p, key, enumValue(i, key, values, a === 'record_inventory_movement' && key === 'movement_type'));
  for (const key of ['quantity','unit_cost']) if (i[key] !== undefined) add(p, key, number(i, key, a === 'record_inventory_movement' && key === 'quantity'));
  for (const key of ['hire_date','shift_date','due_date']) if (p[key] !== undefined && !date.test(String(p[key])) && (key === 'hire_date' || !relativeDate.test(String(p[key])))) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
  for (const key of ['start_time','end_time']) if (i[key] !== undefined) { const v=string(i,key,a==='create_shift'); if (!v || !time.test(v)) throw new Error('INVALID_PROPOSAL_ARGUMENTS'); p[key]=v; }
  if (a === 'create_shift') {
    const shiftDate = string(i,'shift_date',true);
    if (!shiftDate || (!date.test(shiftDate) && !relativeDate.test(shiftDate))) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
    p.shift_date = relativeDate.test(shiftDate) ? shiftDate.toLowerCase() : shiftDate;
  }
  if (a === 'create_announcement' && i.target_roles !== undefined) {
    if (!Array.isArray(i.target_roles) || !i.target_roles.every(v => typeof v === 'string')) throw new Error('INVALID_PROPOSAL_ARGUMENTS');
    p.target_roles = [...i.target_roles].sort();
  }
  return { action: a, payload: p };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function hashProposal(action: ProposalAction, payload: Record<string, unknown>, context: BrainRequestContext, version = PROPOSAL_SCHEMA_VERSION): string {
  assertRequestContext(context);
  return createHash('sha256').update(stable({ action, payload, actorId: context.actor.actorId, tenantId: context.tenant.tenantId, version })).digest('hex');
}

export async function createProposal(store: ProposalStore, input: { context: BrainRequestContext; action: string; rawArguments: unknown; preview: ProposalRecord['preview']; now?: Date }): Promise<ProposalRecord> {
  const normalizedArguments = normalizeTrustedPreviewArguments(input.action, input.rawArguments);
  const { action, payload } = canonicalizeProposalArguments(input.action, normalizedArguments);
  const now = input.now ?? new Date();
  const id = randomUUID();
  const identity = proposalIdentity(input.context);
  const payloadHash = hashProposal(action, payload, input.context);
  const record: ProposalRecord = {
    id, actorId: identity.actorId, profileId: identity.profileId, tenantId: identity.tenantId,
    canonicalAction: action, canonicalPayload: payload, payloadHash, schemaVersion: PROPOSAL_SCHEMA_VERSION,
    risk: action.startsWith('delete_') || action === 'record_inventory_movement' ? 'high' : 'medium',
    requiredRole: action === 'create_employee' ? 'manager_or_above' : null,
    preview: input.preview, status: 'pending', correlationId: input.context.actor.correlationId,
    idempotencyKey: `${id}:${payloadHash}`, createdAt: now.toISOString(), expiresAt: new Date(now.getTime()+PROPOSAL_TTL_MS).toISOString(),
    executedAt: null, safeResult: null,
  };
  await store.insert(record);
  return record;
}

export async function rejectProposal(store: ProposalStore, id: string, context: BrainRequestContext) { return store.reject(id, proposalIdentity(context)); }

export async function claimProposalForExecution(store: ProposalStore, id: string, context: BrainRequestContext, now = new Date()) {
  const identity = proposalIdentity(context);
  const claimed = await store.claim(id, identity, now.toISOString());
  if (claimed.outcome !== 'claimed') return claimed;
  const proposal = claimed.proposal;
  if (proposal.schemaVersion !== PROPOSAL_SCHEMA_VERSION || proposal.actorId !== identity.actorId || proposal.profileId !== identity.profileId || proposal.tenantId !== identity.tenantId || proposal.payloadHash !== hashProposal(proposal.canonicalAction, proposal.canonicalPayload, context, proposal.schemaVersion)) {
    await store.markFailed(proposal.id, proposal.payloadHash, 'PROPOSAL_INTEGRITY_FAILED');
    return { outcome: 'invalid_status' as const };
  }
  return claimed;
}

export async function markProposalExecuted(store: ProposalStore, id: string, hash: string, safeResult: string) { await store.markExecuted(id, hash, safeResult); }
export async function markProposalFailed(store: ProposalStore, id: string, hash: string, code: string) { await store.markFailed(id, hash, code); }
