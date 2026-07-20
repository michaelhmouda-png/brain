const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MaintenanceLocationValidation =
  | { valid: true; locationId: string | null }
  | { valid: false; locationId: null };

export async function validateMaintenanceLocation(
  candidate: unknown,
  companyId: string,
  existsInCompany: (locationId: string, companyId: string) => Promise<boolean>,
): Promise<MaintenanceLocationValidation> {
  if (candidate === null || candidate === undefined || candidate === '') {
    return { valid: true, locationId: null };
  }
  if (typeof candidate !== 'string' || !UUID_PATTERN.test(candidate)) {
    return { valid: false, locationId: null };
  }
  try {
    return await existsInCompany(candidate, companyId)
      ? { valid: true, locationId: candidate }
      : { valid: false, locationId: null };
  } catch {
    return { valid: false, locationId: null };
  }
}
