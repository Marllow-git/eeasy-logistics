// Cash PIN rules (driver app §5.2, document 4 §3.2): four to six Western digits.
export const pinMinLength = 4;
export const pinMaxLength = 6;

export function isValidPin(pin: string): boolean {
  return /^[0-9]{4,6}$/.test(pin);
}
