/**
 * Brain Command Engine — Centralized Date Resolver
 *
 * Converts natural-language date expressions into ISO dates.
 * Used by all write tools to ensure no natural-language words
 * are ever saved directly into the database.
 */

export interface DateResolutionResult {
  date: string;           // ISO date YYYY-MM-DD
  displayText: string;    // Human-readable: "Tomorrow (Friday, July 18, 2026)"
  error?: string;
  ambiguous?: boolean;
}

/**
 * Resolve a natural-language date string to a YYYY-MM-DD ISO date.
 * Returns an error if the date cannot be parsed.
 * Uses local date/time for resolution to ensure correct calendar dates.
 */
export function resolveDate(input: string): DateResolutionResult {
  if (!input || typeof input !== 'string') {
    return { date: '', displayText: '', error: 'Invalid date input.' };
  }

  const raw = input.trim().toLowerCase();
  
  // Get today's date in local time (not UTC)
  const today = new Date();
  // Create a date at midnight local time
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  
  const fmt = (d: Date) => {
    // Format as YYYY-MM-DD in local time
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const display = (label: string, d: Date) => {
    const pretty = d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    return label ? `${label} (${pretty})` : pretty;
  };

  // ── Keywords ────────────────────────────────────────────────────────────────
  if (raw === 'today') return { date: fmt(todayMidnight), displayText: display('Today', todayMidnight) };

  if (raw === 'tomorrow') {
    // Tomorrow is the next calendar day
    const tomorrow = new Date(todayMidnight);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { date: fmt(tomorrow), displayText: display('Tomorrow', tomorrow) };
  }

  if (raw === 'tonight' || raw === 'this evening') {
    return { date: fmt(todayMidnight), displayText: display('Tonight', todayMidnight) };
  }

  // ── "in N days" ──────────────────────────────────────────────────────────────
  const inDaysMatch = raw.match(/^in\s+(\d+)\s+days?$/);
  if (inDaysMatch) {
    const n = parseInt(inDaysMatch[1], 10);
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() + n);
    return { date: fmt(d), displayText: display(`In ${n} day${n > 1 ? 's' : ''}`, d) };
  }

  // ── "in N hours" → treat as today ────────────────────────────────────────────
  const inHoursMatch = raw.match(/^in\s+(\d+)\s+hours?$/);
  if (inHoursMatch) {
    return { date: fmt(todayMidnight), displayText: display('Today', todayMidnight) };
  }

  // ── Day names ────────────────────────────────────────────────────────────────
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const isNextPrefix = raw.startsWith('next ');
  const isThisPrefix = raw.startsWith('this ');
  const strippedRaw = raw.replace(/^(next|this)\s+/, '');

  for (let i = 0; i < dayNames.length; i++) {
    if (strippedRaw === dayNames[i]) {
      const currentDay = todayMidnight.getDay();
      let daysAhead = (i - currentDay + 7) % 7;
      // "next X" always means the following week; same-day means next occurrence
      if (isNextPrefix || daysAhead === 0) daysAhead += 7;
      const d = new Date(todayMidnight);
      d.setDate(d.getDate() + daysAhead);
      return { date: fmt(d), displayText: display(input, d) };
    }
  }

  // ── Month-day patterns ────────────────────────────────────────────────────────
  const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthFull = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  for (let m = 0; m < 12; m++) {
    // "July 20" or "Jul 20" or "Jul. 20"
    const fwdPatternsA = [
      new RegExp(`${monthFull[m]}\\s+(\\d{1,2})`),
      new RegExp(`${monthAbbrevs[m]}\\.?\\s+(\\d{1,2})`),
    ];
    // "20 July" or "20 Jul"
    const fwdPatternsB = [
      new RegExp(`(\\d{1,2})\\s+${monthFull[m]}`),
      new RegExp(`(\\d{1,2})\\s+${monthAbbrevs[m]}\\.?`),
    ];
    for (const pat of [...fwdPatternsA, ...fwdPatternsB]) {
      const match = raw.match(pat);
      if (match) {
        const day = parseInt(match[1], 10);
        const d = new Date(todayMidnight.getFullYear(), m, day);
        if (d < todayMidnight) d.setFullYear(d.getFullYear() + 1);
        return { date: fmt(d), displayText: display('', d) };
      }
    }
  }

  // ── MM/DD slash format ────────────────────────────────────────────────────────
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    const d = new Date(todayMidnight.getFullYear(), month, day);
    if (d < todayMidnight) d.setFullYear(d.getFullYear() + 1);
    return { date: fmt(d), displayText: display('', d) };
  }

  // ── ISO YYYY-MM-DD passthrough ────────────────────────────────────────────────
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return { date: raw, displayText: display('', d) };
    }
  }

  return {
    date: '',
    displayText: '',
    error: `Could not understand "${input}" as a date. Try: "tomorrow", "Friday", "next Monday", "July 20", or YYYY-MM-DD.`,
  };
}

/**
 * Map an urgency phrase to a task priority enum value.
 */
export function mapUrgencyToPriority(urgency?: string): 'Critical' | 'High' | 'Medium' | 'Low' {
  if (!urgency || typeof urgency !== 'string') return 'Medium';
  const u = urgency.trim().toLowerCase();
  if (u.includes('urgent') || u.includes('immediately') || u.includes('critical') || u.includes('asap')) return 'Critical';
  if (u.includes('important') || u.includes('high priority') || u.includes('high')) return 'High';
  if (u.includes('whenever possible') || u.includes('low priority') || u.includes('low')) return 'Low';
  return 'Medium';
}
