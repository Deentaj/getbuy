type NinIdentityNames = {
  first_name?: unknown;
  middle_name?: unknown;
  last_name?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function extractPremblyNinIdentity(response: unknown): NinIdentityNames | null {
  const data = asRecord(asRecord(response)?.data);
  if (!data) return null;

  const firstName = firstString(data, ['firstname', 'first_name', 'firstName']);
  const lastName = firstString(data, ['surname', 'last_name', 'lastname', 'lastName']);
  if (!firstName || !lastName) return null;

  return {
    first_name: firstName,
    middle_name: firstString(data, ['middlename', 'middle_name', 'middleName', 'otherName']),
    last_name: lastName,
  };
}

function nameTokens(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function isValidNin(value: unknown): value is string {
  return typeof value === 'string' && /^\d{11}$/.test(value);
}

export function matchesNinProfileName(profileName: string, entity: NinIdentityNames) {
  if (
    typeof entity.first_name !== 'string'
    || typeof entity.last_name !== 'string'
    || !entity.first_name.trim()
    || !entity.last_name.trim()
  ) {
    return false;
  }

  const accountTokens = nameTokens(profileName);
  const identityTokens = nameTokens([
    entity.first_name,
    typeof entity.middle_name === 'string' ? entity.middle_name : '',
    entity.last_name,
  ].join(' '));
  if (
    accountTokens.length < 2
    || identityTokens.length < 2
    || accountTokens[0] !== identityTokens[0]
    || accountTokens[accountTokens.length - 1] !== identityTokens[identityTokens.length - 1]
  ) {
    return false;
  }

  const accountMiddleNames = accountTokens.slice(1, -1);
  const identityMiddleNames = identityTokens.slice(1, -1);
  return accountMiddleNames.every((middleName, index) => {
    const identityMiddleName = identityMiddleNames[index];
    return Boolean(identityMiddleName)
      && (middleName === identityMiddleName || (middleName.length === 1 && identityMiddleName.startsWith(middleName)));
  });
}
