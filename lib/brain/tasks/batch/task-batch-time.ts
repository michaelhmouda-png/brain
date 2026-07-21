const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

function localParts(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function localDateTimeToInstant(value: string, timeZone: string): { dueAt: string; dueDate: string } {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) throw new Error('INVALID_BATCH_DUE_TIME');
  const requested = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const localAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let candidate = localAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const rendered = localParts(new Date(candidate), timeZone);
    const renderedMatch = LOCAL_DATE_TIME.exec(rendered);
    if (!renderedMatch) throw new Error('INVALID_COMPANY_TIMEZONE');
    const renderedAsUtc = Date.UTC(Number(renderedMatch[1]), Number(renderedMatch[2]) - 1, Number(renderedMatch[3]), Number(renderedMatch[4]), Number(renderedMatch[5]));
    candidate += localAsUtc - renderedAsUtc;
  }
  if (localParts(new Date(candidate), timeZone) !== requested) throw new Error('NONEXISTENT_BATCH_DUE_TIME');
  if ([candidate - 3_600_000, candidate + 3_600_000].some((other) => localParts(new Date(other), timeZone) === requested)) {
    throw new Error('AMBIGUOUS_BATCH_DUE_TIME');
  }
  return { dueAt: new Date(candidate).toISOString(), dueDate: requested.slice(0, 10) };
}
