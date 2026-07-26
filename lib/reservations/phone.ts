const CALLING_CODE = /^\+[1-9]\d{0,3}$/;
const NATIONAL = /^\d{4,14}$/;

export type NormalizedPhone = {
  countryCallingCode: string;
  nationalPhoneNumber: string;
  phoneE164: string;
};

export function normalizePhone(countryCallingCode: unknown, phoneNumber: unknown): NormalizedPhone {
  if (typeof countryCallingCode !== 'string' || typeof phoneNumber !== 'string') {
    throw new Error('RESERVATION_PHONE_INVALID');
  }
  const callingCode = countryCallingCode.replace(/[\s()-]/g, '');
  let national = phoneNumber.replace(/[^\d+]/g, '');
  if (!CALLING_CODE.test(callingCode)) throw new Error('RESERVATION_CALLING_CODE_INVALID');
  if (national.startsWith(callingCode)) national = national.slice(callingCode.length);
  if (national.startsWith('+')) throw new Error('RESERVATION_PHONE_INVALID');
  national = national.replace(/^0+/, '');
  if (!NATIONAL.test(national) || callingCode.length + national.length > 16) {
    throw new Error('RESERVATION_PHONE_INVALID');
  }
  return {
    countryCallingCode: callingCode,
    nationalPhoneNumber: national,
    phoneE164: `${callingCode}${national}`,
  };
}

export function maskPhone(phoneE164: string): string {
  if (phoneE164.length <= 5) return '••••';
  return `${phoneE164.slice(0, 3)}••••${phoneE164.slice(-2)}`;
}
