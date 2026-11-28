import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPremblyNinIdentity,
  isValidNin,
  matchesNinProfileName,
} from './nin-verification.ts';

test('accepts only an 11-digit NIN', () => {
  assert.equal(isValidNin('12345678901'), true);
  assert.equal(isValidNin('1234567890'), false);
  assert.equal(isValidNin('1234567890a'), false);
  assert.equal(isValidNin(12345678901), false);
});

test('matches ordered account names and accepts a matching middle initial', () => {
  assert.equal(matchesNinProfileName('Ada O. Okafor', {
    first_name: 'ADA',
    middle_name: 'Oluwatobi',
    last_name: 'Okafor',
  }), true);
});

test('extracts names from Prembly NIN Basic data', () => {
  assert.deepEqual(extractPremblyNinIdentity({
    data: {
      firstname: 'Ada',
      middlename: 'Oluwatobi',
      surname: 'Okafor',
    },
  }), {
    first_name: 'Ada',
    middle_name: 'Oluwatobi',
    last_name: 'Okafor',
  });
  assert.deepEqual(extractPremblyNinIdentity({
    data: {
      first_name: 'Ada',
      lastName: 'Okafor',
    },
  }), {
    first_name: 'Ada',
    middle_name: undefined,
    last_name: 'Okafor',
  });
  assert.equal(extractPremblyNinIdentity({ data: { firstname: 'Ada' } }), null);
});

test('rejects mismatched or incomplete identity names', () => {
  assert.equal(matchesNinProfileName('Ada Okafor', {
    first_name: 'Ada',
    last_name: 'Nwosu',
  }), false);
  assert.equal(matchesNinProfileName('Ada Okafor', {
    first_name: 'Okafor',
    last_name: 'Ada',
  }), false);
  assert.equal(matchesNinProfileName('Ada', {
    first_name: 'Ada',
    last_name: 'Okafor',
  }), false);
  assert.equal(matchesNinProfileName('Ada Okafor', {
    first_name: 'Ada',
  }), false);
});
