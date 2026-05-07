'use client';
import { useMemo } from 'react';
import { FlagIcon } from './Combobox';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

const PRIORITY: CountryCode[] = ['IN', 'US', 'GB', 'AE', 'CA', 'AU', 'SG'];

const REGION_NAMES =
  typeof Intl !== 'undefined' && (Intl as any).DisplayNames
    ? new (Intl as any).DisplayNames(['en'], { type: 'region' })
    : null;

interface Props {
  country: CountryCode;
  onCountryChange: (c: CountryCode) => void;
  value: string; // national digits only
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
}

export function PhoneInput({
  country, onCountryChange, value, onChange, label = 'Mobile number', error, required,
}: Props) {
  const countries = useMemo(() => {
    const all = getCountries();
    const rest = all.filter((c) => !PRIORITY.includes(c)).sort((a, b) => {
      const an = REGION_NAMES?.of(a) ?? a;
      const bn = REGION_NAMES?.of(b) ?? b;
      return an.localeCompare(bn);
    });
    return [...PRIORITY.filter((c) => all.includes(c)), ...rest];
  }, []);

  const formatted = useMemo(() => {
    if (!value) return '';
    return new AsYouType(country).input(value);
  }, [value, country]);

  return (
    <label className="block w-full">
      {label && (
        <span className="mb-1 block text-sm font-semibold text-ink">
          {label}{required && <span className="text-brand"> *</span>}
        </span>
      )}
      <div className={`flex h-11 w-full items-stretch rounded-2xl border bg-white focus-within:ring-2 focus-within:ring-brand/30 ${error ? 'border-brand' : 'border-line'}`}>
        <div className="relative flex items-center pl-3 pr-1">
          <FlagIcon code={country} alt={country} />
          <span className="ml-2 text-sm font-medium text-ink/80">+{getCountryCallingCode(country)}</span>
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => onCountryChange(e.target.value as CountryCode)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {countries.map((c) => (
              <option key={c} value={c}>
                {REGION_NAMES?.of(c) ?? c} (+{getCountryCallingCode(c)})
              </option>
            ))}
          </select>
          <svg className="ml-1 h-3 w-3 text-ink/50" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="my-2 w-px bg-line" />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Mobile number"
          value={formatted}
          required={required}
          onChange={(e) => {
            onChange(toNationalDigits(country, e.target.value));
          }}
          className="flex-1 bg-transparent px-3 text-ink placeholder:text-subtle outline-none"
        />
      </div>
      {error && <span className="mt-1 block text-xs font-semibold text-brand">{error}</span>}
    </label>
  );
}

export function isPhoneValid(country: CountryCode, national: string) {
  if (!national) return false;
  const parsed = parsePhoneNumberFromString(national, country);
  return parsed?.isValid() ?? isValidPhoneNumber(national, country);
}

export function toE164(country: CountryCode, national: string) {
  const parsed = parsePhoneNumberFromString(national, country);
  if (parsed?.number) return parsed.number;
  const digits = toNationalDigits(country, national);
  return `+${getCountryCallingCode(country)}${digits}`;
}

export function toNationalDigits(country: CountryCode, value: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = parsePhoneNumberFromString(raw, country);
  if (parsed?.nationalNumber && (raw.includes('+') || parsed.isPossible())) return parsed.nationalNumber;
  const digits = raw.replace(/\D/g, '');
  const dialCode = getCountryCallingCode(country);
  if (raw.startsWith('+') && digits.startsWith(dialCode)) return digits.slice(dialCode.length);
  return digits;
}

export function splitStoredPhone(value: string | undefined | null, fallbackCountry: CountryCode = 'IN') {
  const raw = String(value ?? '').trim();
  if (!raw) return { country: fallbackCountry, national: '' };
  const parsed = parsePhoneNumberFromString(raw) || parsePhoneNumberFromString(raw, fallbackCountry);
  if (parsed?.nationalNumber) {
    return {
      country: (parsed.country as CountryCode | undefined) ?? fallbackCountry,
      national: parsed.nationalNumber,
    };
  }
  return { country: fallbackCountry, national: toNationalDigits(fallbackCountry, raw) };
}
