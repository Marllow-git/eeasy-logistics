import { gate, type GateInput } from '../src/domain/gate';
import { composePhone, isPlausiblePhone } from '../src/domain/phone';
import { isValidPin } from '../src/domain/pin';
import { isOlderThan } from '../src/domain/version';

// Pure rules of DRV-1: the route gate (plan 2.1), the phone field (2.5), the PIN shape (2.6) and the
// minimum version (2.9).

const signedIn: GateInput = {
  hydrated: true,
  signedIn: true,
  updateRequired: false,
  cashPinSet: true,
  cashPinLocked: false,
  verifierArmed: true,
  permissionsDone: true,
};

describe('gate', () => {
  it.each<[string, Partial<GateInput>, ReturnType<typeof gate>]>([
    ['not read yet', { hydrated: false }, 'loading'],
    ['426 from the API, signed in or not', { updateRequired: true, signedIn: false }, 'update'],
    ['no session', { signedIn: false }, 'auth'],
    ['first sign-in, no PIN', { cashPinSet: false, verifierArmed: false }, 'setup-pin'],
    ['first sign-in, a stale verifier', { cashPinSet: false, verifierArmed: true }, 'setup-pin'],
    ['a PIN, no verifier on this phone', { verifierArmed: false }, 'setup-pin'],
    [
      'a PIN not known offline, no verifier',
      { cashPinSet: undefined, verifierArmed: false },
      'setup-pin',
    ],
    ['a PIN locked by the server', { verifierArmed: false, cashPinLocked: true }, 'app'],
    ['PIN done, permissions not', { permissionsDone: false }, 'setup-permissions'],
    ['everything done', {}, 'app'],
    ['offline with a verifier', { cashPinSet: undefined }, 'app'],
  ])('%s', (_name, patch, expected) => {
    expect(gate({ ...signedIn, ...patch })).toBe(expected);
  });
});

describe('phone', () => {
  it.each([
    ['5 0000 0001', '+966500000001'],
    ['0500000001', '+966500000001'],
    ['٠٥٠٠٠٠٠٠٠١', '+966500000001'],
    ['+966 50 000 0001', '+966500000001'],
    ['00966500000001', '+966500000001'],
    ['966500000001', '+966500000001'],
  ])('%s → %s', (input, expected) => {
    expect(composePhone(input)).toBe(expected);
  });

  it('waits for enough digits', () => {
    expect(isPlausiblePhone('5000')).toBe(false);
    expect(isPlausiblePhone('500000001')).toBe(true);
  });
});

describe('PIN shape', () => {
  it.each([
    ['123', false],
    ['1234', true],
    ['123456', true],
    ['1234567', false],
    ['12a4', false],
    ['١٢٣٤', false],
  ])('%s → %s', (pin, valid) => {
    expect(isValidPin(pin)).toBe(valid);
  });
});

describe('minimum version', () => {
  it.each([
    ['1.3.9', '1.4.0', true],
    ['1.4.0', '1.4.0', false],
    ['1.10.0', '1.9.9', false],
    ['0.0.0', undefined, false],
    ['dev', '1.0.0', false],
  ])('%s against %s → %s', (current, minimum, older) => {
    expect(isOlderThan(current, minimum)).toBe(older);
  });
});
