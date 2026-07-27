export function venueDate(timezone?: string, instant = new Date()) {
  if (!timezone) {
    const year = instant.getFullYear();
    const month = String(instant.getMonth() + 1).padStart(2, '0');
    const day = String(instant.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
