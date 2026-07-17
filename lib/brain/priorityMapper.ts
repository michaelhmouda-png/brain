/**
 * Brain Command Engine — Centralized Priority Mapper
 *
 * Converts natural language urgency/priority to standardized lowercase
 * database enum values. All task creation paths must use this mapper
 * to ensure consistency.
 *
 * Database supports: 'critical' | 'high' | 'medium' | 'low'
 */

export type DBPriority = 'critical' | 'high' | 'medium' | 'low';

export interface PriorityMappingResult {
  dbValue: DBPriority;           // Lowercase enum for database
  displayValue: string;           // Capitalized for UI display: "Critical", "High", etc.
}

/**
 * Map natural language priority/urgency to database enum value.
 * Returns both the database value (lowercase) and display value (capitalized).
 *
 * @param input - Natural language urgency: "urgent", "critical", "high", "normal", etc.
 * @returns Object with dbValue (for database) and displayValue (for UI)
 */
export function mapPriorityToDatabase(input?: string): PriorityMappingResult {
  if (!input || typeof input !== 'string') {
    return { dbValue: 'medium', displayValue: 'Medium' };
  }

  const normalized = input.trim().toLowerCase();

  // === CRITICAL ===
  if (
    normalized.includes('urgent') ||
    normalized.includes('immediately') ||
    normalized.includes('critical') ||
    normalized.includes('asap') ||
    normalized.includes('highest') ||
    normalized.includes('emergency')
  ) {
    return { dbValue: 'critical', displayValue: 'Critical' };
  }

  // === HIGH ===
  if (
    normalized.includes('important') ||
    normalized.includes('high priority') ||
    normalized === 'high'
  ) {
    return { dbValue: 'high', displayValue: 'High' };
  }

  // === LOW ===
  if (
    normalized.includes('whenever possible') ||
    normalized.includes('low priority') ||
    normalized === 'low'
  ) {
    return { dbValue: 'low', displayValue: 'Low' };
  }

  // === DEFAULT: MEDIUM ===
  // Covers: 'normal', 'standard', 'regular', 'medium', or any unknown value
  return { dbValue: 'medium', displayValue: 'Medium' };
}

/**
 * Normalize a priority value to database enum.
 * Accepts both natural language and enum values.
 *
 * @param input - Can be natural language ("urgent") or enum value ("critical")
 * @returns Lowercase database enum value
 */
export function normalizePriority(input?: string): DBPriority {
  const result = mapPriorityToDatabase(input);
  return result.dbValue;
}

/**
 * Format a database priority for display.
 * @param dbValue - Lowercase database value
 * @returns Capitalized display string
 */
export function displayPriority(dbValue: DBPriority): string {
  const map: Record<DBPriority, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };
  return map[dbValue] || 'Medium';
}

/**
 * Validate that a priority is a valid database enum value.
 * @param value - Value to validate
 * @returns true if valid, false otherwise
 */
export function isValidDBPriority(value: unknown): value is DBPriority {
  return (
    typeof value === 'string' &&
    ['critical', 'high', 'medium', 'low'].includes(value)
  );
}
