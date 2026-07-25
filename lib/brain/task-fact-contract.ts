export const TASK_COUNT_HISTORY_SUPPORTED = false;

export type BrainConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type DeterministicBrainScore = {
  total: number;
  categories?: {
    operations: number;
    employees: number;
    inventory: number;
    customers: number;
    data_quality: number;
  };
  activeTasks: number;
  overdueTasks: number;
};

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mentionsOverdueTasks(value: string): boolean {
  const normalized = normalize(value);
  return /\boverdue tasks?\b|\btasks? (?:are |were )?overdue\b/.test(normalized);
}

export function brainScoreRequestUsesCurrentScoreIntent(message: string): boolean {
  const normalized = normalize(message);
  return /\b(?:business )?brain score\b/.test(normalized)
    || /(?:درجة|نتيجة|سكور)\s+برين/u.test(normalized);
}

export function taskRequestQuestionsEarlierOverdueCount(
  latestMessage: string,
  conversation: readonly BrainConversationMessage[],
): boolean {
  const normalized = normalize(latestMessage);
  const questionsEarlierAnswer = [
    /\byou (?:said|reported|told me|mentioned)\b/,
    /\b(?:earlier|before|previously|last time|a moment ago)\b/,
    /\bthere (?:was|were|used to be)\b/,
    /\bthe (?:earlier|previous) (?:answer|count|number)\b/,
  ].some((pattern) => pattern.test(normalized));
  if (!questionsEarlierAnswer) return false;
  if (mentionsOverdueTasks(latestMessage)) return true;
  return conversation.slice(-6).some((message) => mentionsOverdueTasks(message.content));
}

export function formatCurrentOverdueCount(overdueCount: number): string {
  return `You have ${overdueCount} overdue ${overdueCount === 1 ? 'task' : 'tasks'}.`;
}

export function formatEarlierOverdueCountWithoutHistory(overdueCount: number): string {
  return `The current live count is ${overdueCount}. I do not have a stored historical snapshot proving why the earlier answer differed.`;
}

export function formatDeterministicBrainScore(score: DeterministicBrainScore): string {
  const lines = [`Business Brain Score: ${score.total}/100.`];
  if (score.categories) {
    lines.push(
      `Operations ${score.categories.operations}, employees ${score.categories.employees}, ` +
      `inventory ${score.categories.inventory}, customers ${score.categories.customers}, ` +
      `data quality ${score.categories.data_quality}.`,
    );
  }
  lines.push(
    `The canonical task snapshot contains ${score.activeTasks} active ` +
    `${score.activeTasks === 1 ? 'task' : 'tasks'} and ${score.overdueTasks} overdue ` +
    `${score.overdueTasks === 1 ? 'task' : 'tasks'}.`,
  );
  return lines.join('\n');
}

export function responseClaimsUnsupportedServerOperation(input: {
  message: string;
  successfulDataRead: boolean;
  successfulReadOperations?: readonly string[];
  taskAuditSupported?: boolean;
  historicalSnapshotSupported?: boolean;
}): boolean {
  const normalized = normalize(input.message);
  const claimsRead = /\bi (?:re ?checked|checked|queried|refreshed|re ?ran|looked up)\b/.test(normalized);
  if (claimsRead && !input.successfulDataRead) return true;
  const claimsTaskRead = claimsRead && /\b(?:brain score|tasks?|overdue)\b/.test(normalized);
  if (claimsTaskRead && input.successfulReadOperations &&
      !input.successfulReadOperations.some((operation) =>
        ['get_tasks', 'get_brain_score', 'prepare_for_event'].includes(operation))) {
    return true;
  }

  const claimsAudit = /\bi (?:ran |performed |completed )?(?:an )?audit(?:ed)?\b/.test(normalized)
    || /\baudit(?:ed)? (?:who|which user|task changes?)\b/.test(normalized);
  if (claimsAudit && !input.taskAuditSupported) return true;

  const inventsHistoryCause = /\b(?:earlier|previous|old) (?:brain score |task )?snapshot\b/.test(normalized)
    || /\b(?:cache|cached|caching)\b.{0,80}\b(?:caused|explains?|was|had|used)\b/.test(normalized);
  return inventsHistoryCause && !input.historicalSnapshotSupported;
}

export const UNSUPPORTED_OPERATION_CLAIM_RESPONSE =
  'I cannot verify that explanation from a supported server operation. Ask for the current count and I will return the canonical live value.';
