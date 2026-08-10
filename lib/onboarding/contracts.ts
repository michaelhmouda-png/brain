export type InitialCustomerUser = {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  role: 'owner' | 'manager' | 'employee';
  language: 'en' | 'ar';
};

export type FirstCustomerPayload = {
  companyName: string;
  industry: string;
  country: string;
  currency: string;
  timezone: string;
  location: { name: string; type: string; city: string; address: string };
  users: InitialCustomerUser[];
};

const text = (value: unknown, maximum: number) => typeof value === 'string' && value.trim().length > 0
  && value.trim().length <= maximum ? value.trim() : null;
const email = (value: unknown) => {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
};

export function parseFirstCustomerPayload(input: unknown): FirstCustomerPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const location = body.location && typeof body.location === 'object' && !Array.isArray(body.location)
    ? body.location as Record<string, unknown>
    : null;
  if (!location || !Array.isArray(body.users) || body.users.length < 1 || body.users.length > 25) return null;
  const companyName = text(body.companyName, 120);
  const country = text(body.country, 80);
  const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency.trim()) ? body.currency.trim() : null;
  const timezone = text(body.timezone, 120);
  const locationName = text(location.name, 120);
  const locationType = text(location.type, 80);
  const city = text(location.city, 120);
  if (!companyName || !country || !currency || !timezone || !locationName || !locationType || !city) return null;

  const seen = new Set<string>();
  const users: InitialCustomerUser[] = [];
  for (const raw of body.users) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const normalizedEmail = email(item.email);
    const firstName = text(item.firstName, 80);
    const lastName = text(item.lastName, 80);
    const jobTitle = text(item.jobTitle, 120);
    const department = text(item.department, 120);
    const role = item.role;
    const language = item.language;
    if (!normalizedEmail || !firstName || !lastName || !jobTitle || !department
      || !['owner', 'manager', 'employee'].includes(String(role))
      || !['en', 'ar'].includes(String(language)) || seen.has(normalizedEmail)) return null;
    seen.add(normalizedEmail);
    users.push({
      email: normalizedEmail, firstName, lastName, jobTitle, department,
      role: role as InitialCustomerUser['role'], language: language as InitialCustomerUser['language'],
    });
  }
  if (!users.some((user) => user.role === 'owner')) return null;
  return {
    companyName,
    industry: text(body.industry, 120) ?? 'hospitality',
    country,
    currency,
    timezone,
    location: {
      name: locationName,
      type: locationType,
      city,
      address: typeof location.address === 'string' ? location.address.trim().slice(0, 500) : '',
    },
    users,
  };
}

export const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
