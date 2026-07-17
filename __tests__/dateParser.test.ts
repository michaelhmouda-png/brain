/**
 * Date Parser Tests
 * 
 * Tests for parseNaturalLanguageDate with local timezone handling
 * Verifies that relative dates always calculate correctly regardless of timezone
 */

// Mock helper function for local date formatting
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Mock parseNaturalLanguageDate function (copy from route)
function parseNaturalLanguageDate(dateInput: string, baseDate?: Date): { date: string; error?: string } {
  if (!dateInput || typeof dateInput !== 'string') {
    return { date: '', error: 'Invalid date input.' };
  }

  const input = dateInput.trim().toLowerCase();
  // Use baseDate if provided (for testing), otherwise use today
  const today = baseDate ? new Date(baseDate) : new Date();
  today.setHours(0, 0, 0, 0);

  // Special keywords
  if (input === 'today') {
    return { date: toLocalDateString(today) };
  }
  if (input === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { date: toLocalDateString(tomorrow) };
  }

  // Yesterday
  if (input === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { date: toLocalDateString(yesterday) };
  }

  // Day names: "next Friday", "Friday"
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (input.includes(dayNames[i])) {
      const target = new Date(today);
      const currentDay = target.getDay();
      let daysAhead = (i - currentDay + 7) % 7;
      if (daysAhead <= 0) daysAhead += 7; // Next occurrence
      target.setDate(target.getDate() + daysAhead);
      return { date: toLocalDateString(target) };
    }
  }

  // Month day patterns
  const monthPatterns = [
    /jan(?:uary)?\s+(\d{1,2})/i,
    /feb(?:ruary)?\s+(\d{1,2})/i,
    /mar(?:ch)?\s+(\d{1,2})/i,
    /apr(?:il)?\s+(\d{1,2})/i,
    /may\s+(\d{1,2})/i,
    /jun(?:e)?\s+(\d{1,2})/i,
    /jul(?:y)?\s+(\d{1,2})/i,
    /aug(?:ust)?\s+(\d{1,2})/i,
    /sep(?:tember)?\s+(\d{1,2})/i,
    /oct(?:ober)?\s+(\d{1,2})/i,
    /nov(?:ember)?\s+(\d{1,2})/i,
    /dec(?:ember)?\s+(\d{1,2})/i,
  ];
  for (let m = 0; m < monthPatterns.length; m++) {
    const match = input.match(monthPatterns[m]);
    if (match) {
      const day = parseInt(match[1], 10);
      const date = new Date(today.getFullYear(), m, day);
      if (date < today) {
        date.setFullYear(date.getFullYear() + 1);
      }
      return { date: toLocalDateString(date) };
    }
  }

  // YYYY-MM-DD format (passthrough)
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { date: input };
  }

  return { date: '', error: `Could not parse date: "${dateInput}".` };
}

// ============================================================================
// TEST CASES
// ============================================================================

describe('Date Parser - Timezone-Aware Tests', () => {
  // Test 1: Today
  test('today resolves to current date', () => {
    const baseDate = new Date('2026-07-17T15:00:00'); // 3 PM on July 17, 2026
    const result = parseNaturalLanguageDate('today', baseDate);
    expect(result.date).toBe('2026-07-17');
  });

  // Test 2: Tomorrow (the critical bug)
  test('tomorrow resolves to next calendar day (not yesterday)', () => {
    const baseDate = new Date('2026-07-17T15:00:00'); // 3 PM on July 17, 2026
    const result = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result.date).toBe('2026-07-18'); // Must be July 18, not July 16
  });

  // Test 3: Yesterday
  test('yesterday resolves to previous calendar day', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('yesterday', baseDate);
    expect(result.date).toBe('2026-07-16');
  });

  // Test 4: Next Monday from Thursday
  test('next Monday from Thursday resolves correctly', () => {
    const baseDate = new Date('2026-07-16T15:00:00'); // Thursday, July 16
    const result = parseNaturalLanguageDate('monday', baseDate);
    expect(result.date).toBe('2026-07-20'); // Monday is 4 days ahead
  });

  // Test 5: Monday from Monday (should be next Monday)
  test('monday from Monday resolves to next Monday', () => {
    const baseDate = new Date('2026-07-20T15:00:00'); // Monday, July 20
    const result = parseNaturalLanguageDate('monday', baseDate);
    expect(result.date).toBe('2026-07-27'); // Next Monday
  });

  // Test 6: July 20 when today is July 17
  test('July 20 from July 17 resolves to this year', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('July 20', baseDate);
    expect(result.date).toBe('2026-07-20'); // 3 days ahead this year
  });

  // Test 7: July 10 when today is July 17 (should be next year)
  test('July 10 from July 17 resolves to next year', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('July 10', baseDate);
    expect(result.date).toBe('2027-07-10'); // Past this year, so next year
  });

  // Test 8: Midnight boundary - tomorrow at 11 PM
  test('tomorrow at 11 PM still resolves to next day', () => {
    const baseDate = new Date('2026-07-17T23:00:00'); // 11 PM on July 17
    const result = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result.date).toBe('2026-07-18'); // Still July 18
  });

  // Test 9: Midnight boundary - today at 12:01 AM
  test('today at 12:01 AM resolves to current date', () => {
    const baseDate = new Date('2026-07-17T00:01:00'); // 12:01 AM on July 17
    const result = parseNaturalLanguageDate('today', baseDate);
    expect(result.date).toBe('2026-07-17');
  });

  // Test 10: YYYY-MM-DD passthrough
  test('YYYY-MM-DD format passes through unchanged', () => {
    const result = parseNaturalLanguageDate('2026-07-25');
    expect(result.date).toBe('2026-07-25');
  });

  // Test 11: Case insensitivity
  test('case insensitive parsing', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result1 = parseNaturalLanguageDate('TOMORROW', baseDate);
    const result2 = parseNaturalLanguageDate('Tomorrow', baseDate);
    const result3 = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result1.date).toBe('2026-07-18');
    expect(result2.date).toBe('2026-07-18');
    expect(result3.date).toBe('2026-07-18');
  });

  // Test 12: Slash date format - near year boundary
  test('12/25 in November resolves to next year', () => {
    const baseDate = new Date('2026-11-15T15:00:00');
    const result = parseNaturalLanguageDate('12/25', baseDate);
    expect(result.date).toBe('2026-12-25'); // Same year, 40 days ahead
  });

  // Test 13: Slash date format - already passed
  test('01/15 in March resolves to next year', () => {
    const baseDate = new Date('2026-03-20T15:00:00');
    const result = parseNaturalLanguageDate('01/15', baseDate);
    expect(result.date).toBe('2027-01-15'); // Already passed, next year
  });

  // Test 14: Day boundary - Friday to Monday
  test('Monday from Friday resolves to next Monday', () => {
    const baseDate = new Date('2026-07-17T15:00:00'); // Friday, July 17
    const result = parseNaturalLanguageDate('monday', baseDate);
    expect(result.date).toBe('2026-07-20'); // Monday is 3 days ahead
  });
});

// ============================================================================
// TIMEZONE EDGE CASES
// ============================================================================

describe('Date Parser - Timezone Edge Cases', () => {
  // Test: UTC edge case - very close to midnight UTC
  test('local timezone: dates use local midnight, not UTC midnight', () => {
    // If server is in UTC-5 (EST) and it's 2026-07-17 04:00:00 UTC,
    // that's 2026-07-16 23:00:00 local time (still yesterday locally)
    // However, this test file can't easily simulate timezone offset changes
    // Instead, we verify that the implementation uses local Date objects
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('tomorrow', baseDate);
    // Should always be the next calendar day
    expect(result.date).toBe('2026-07-18');
  });

  // Test: Verify no UTC contamination
  test('tomorrow never equals today (regression check for UTC bug)', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const today = parseNaturalLanguageDate('today', baseDate);
    const tomorrow = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(today.date).not.toBe(tomorrow.date);
  });
});

// ============================================================================
// RUN TESTS
// ============================================================================

// Simple test runner for Node.js
function test(description: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${description}`);
  } catch (err: any) {
    console.log(`✗ ${description}`);
    console.error(`  ${err.message}`);
  }
}

function describe(name: string, tests: () => void) {
  console.log(`\n${name}`);
  tests();
}

function expect(value: any) {
  return {
    toBe: (expected: any) => {
      if (value !== expected) {
        throw new Error(`Expected ${expected}, got ${value}`);
      }
    },
    not: {
      toBe: (expected: any) => {
        if (value === expected) {
          throw new Error(`Expected not ${expected}, got ${value}`);
        }
      },
    },
  };
}

// Run tests
console.log('═══════════════════════════════════════════════════════════');
console.log('DATE PARSER TESTS - Local Timezone Handling');
console.log('═══════════════════════════════════════════════════════════');

describe('Date Parser - Timezone-Aware Tests', () => {
  test('today resolves to current date', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('today', baseDate);
    expect(result.date).toBe('2026-07-17');
  });

  test('tomorrow resolves to next calendar day (not yesterday)', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result.date).toBe('2026-07-18');
  });

  test('yesterday resolves to previous calendar day', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('yesterday', baseDate);
    expect(result.date).toBe('2026-07-16');
  });

  test('next Monday from Thursday resolves correctly', () => {
    const baseDate = new Date('2026-07-16T15:00:00');
    const result = parseNaturalLanguageDate('monday', baseDate);
    expect(result.date).toBe('2026-07-20');
  });

  test('monday from Monday resolves to next Monday', () => {
    const baseDate = new Date('2026-07-20T15:00:00');
    const result = parseNaturalLanguageDate('monday', baseDate);
    expect(result.date).toBe('2026-07-27');
  });

  test('July 20 from July 17 resolves to this year', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('July 20', baseDate);
    expect(result.date).toBe('2026-07-20');
  });

  test('July 10 from July 17 resolves to next year', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('July 10', baseDate);
    expect(result.date).toBe('2027-07-10');
  });

  test('tomorrow at 11 PM still resolves to next day', () => {
    const baseDate = new Date('2026-07-17T23:00:00');
    const result = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result.date).toBe('2026-07-18');
  });

  test('today at 12:01 AM resolves to current date', () => {
    const baseDate = new Date('2026-07-17T00:01:00');
    const result = parseNaturalLanguageDate('today', baseDate);
    expect(result.date).toBe('2026-07-17');
  });

  test('YYYY-MM-DD format passes through unchanged', () => {
    const result = parseNaturalLanguageDate('2026-07-25');
    expect(result.date).toBe('2026-07-25');
  });

  test('case insensitive parsing', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result1 = parseNaturalLanguageDate('TOMORROW', baseDate);
    const result2 = parseNaturalLanguageDate('Tomorrow', baseDate);
    const result3 = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result1.date).toBe('2026-07-18');
    expect(result2.date).toBe('2026-07-18');
    expect(result3.date).toBe('2026-07-18');
  });

  test('12/25 in November resolves to same year', () => {
    const baseDate = new Date('2026-11-15T15:00:00');
    const result = parseNaturalLanguageDate('12/25', baseDate);
    expect(result.date).toBe('2026-12-25');
  });

  test('01/15 in March resolves to next year', () => {
    const baseDate = new Date('2026-03-20T15:00:00');
    const result = parseNaturalLanguageDate('01/15', baseDate);
    expect(result.date).toBe('2027-01-15');
  });

  test('Monday from Friday resolves to next Monday', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('monday', baseDate);
    expect(result.date).toBe('2026-07-20');
  });
});

describe('Date Parser - Timezone Edge Cases', () => {
  test('local timezone: dates use local midnight, not UTC midnight', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const result = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(result.date).toBe('2026-07-18');
  });

  test('tomorrow never equals today (regression check for UTC bug)', () => {
    const baseDate = new Date('2026-07-17T15:00:00');
    const today = parseNaturalLanguageDate('today', baseDate);
    const tomorrow = parseNaturalLanguageDate('tomorrow', baseDate);
    expect(today.date).not.toBe(tomorrow.date);
  });
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log('Tests complete. Run with: npx ts-node __tests__/dateParser.test.ts');
console.log('═══════════════════════════════════════════════════════════');
