// Builds `breached-passwords.sha1` (PLAT-11 plan 2.2; README.md in this folder): the SHA-1 digests
// of SecLists' `100k-most-used-passwords-NCSC.txt` entries of 12 characters or more, sorted, 20
// bytes each, no separator. Shorter entries can never pass the length rule, so nothing is lost.
//
//   node apps/api/resources/build-breached-list.mjs <path to 100k-most-used-passwords-NCSC.txt>
//
// The source file is downloaded by hand into a directory of its own (it is untrusted data) and is
// not committed; the output is, together with this script.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/** The length rule of `passwords.ts`, in Unicode code points. */
const minimumLength = 12;

const source = process.argv[2];
if (source === undefined) {
  console.error('usage: node build-breached-list.mjs <100k-most-used-passwords-NCSC.txt>');
  process.exit(64);
}

const entries = new Set();
for (const line of readFileSync(source, 'utf8').split('\n')) {
  const password = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (Array.from(password).length >= minimumLength) entries.add(password);
}

const digests = [...entries]
  .map((password) => createHash('sha1').update(password, 'utf8').digest())
  .sort(Buffer.compare);
const output = Buffer.concat(digests);
const target = new URL('./breached-passwords.sha1', import.meta.url);
writeFileSync(target, output);
console.log(
  `${digests.length} digests, ${output.length} bytes, sha256 ${createHash('sha256').update(output).digest('hex')}`,
);
