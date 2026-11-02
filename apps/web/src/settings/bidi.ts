/**
 * A value of the other direction inside a sentence (an email in an Arabic line, web §5), wrapped
 * in First Strong Isolate and Pop Directional Isolate so it neither reorders the punctuation
 * around it nor takes it along.
 */
export function isolate(value: string): string {
  return `\u2068${value}\u2069`;
}
