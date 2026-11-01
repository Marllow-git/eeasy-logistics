// eeasy/no-physical-direction-utilities (WEB-1 plan 2.3): the red fixture reports every physical
// utility with its logical replacement; the green fixture reports nothing. Run: pnpm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { logicalCss } from '../index.js';
import { logicalReplacement } from '../rules/no-physical-direction-utilities.js';

const fixtures = join(import.meta.dirname, 'fixtures');

function lint(file) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    readFileSync(join(fixtures, file), 'utf8'),
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      ...logicalCss,
    ],
    { filename: join(fixtures, file) },
  );
}

describe('eeasy/no-physical-direction-utilities', () => {
  it('reports every physical utility of the red fixture (clsx object keys included), with its logical replacement', () => {
    const messages = lint('physical.tsx');
    assert.deepEqual(
      messages.map((m) => [m.ruleId, m.message.match(/"([^"]+)"[^"]+"([^"]+)"/).slice(1)]),
      [
        ['eeasy/no-physical-direction-utilities', ['ml-2', 'ms-2']],
        ['eeasy/no-physical-direction-utilities', ['pl-4', 'ps-4']],
        ['eeasy/no-physical-direction-utilities', ['pr-4', 'pe-4']],
        ['eeasy/no-physical-direction-utilities', ['mr-4', 'me-4']],
        ['eeasy/no-physical-direction-utilities', ['text-left', 'text-start']],
        ['eeasy/no-physical-direction-utilities', ['rounded-l-md', 'rounded-s-md']],
        ['eeasy/no-physical-direction-utilities', ['border-r-2', 'border-e-2']],
        ['eeasy/no-physical-direction-utilities', ['md:left-0', 'md:start-0']],
        ['eeasy/no-physical-direction-utilities', ['rtl:-ml-1', 'rtl:-ms-1']],
        ['eeasy/no-physical-direction-utilities', ['float-right', 'float-end']],
        ['eeasy/no-physical-direction-utilities', ['right-3', 'end-3']],
        ['eeasy/no-physical-direction-utilities', ['ml-4', 'ms-4']],
      ],
    );
  });

  it('reports nothing in the green fixture', () => {
    assert.deepEqual(lint('logical.tsx'), []);
  });

  it('maps every listed physical family to its logical one', () => {
    const cases = {
      'ml-auto': 'ms-auto',
      'mr-px': 'me-px',
      'pl-0': 'ps-0',
      'pr-[3px]': 'pe-[3px]',
      'left-1/2': 'start-1/2',
      '-right-2': '-end-2',
      'text-right': 'text-end',
      'rounded-r-lg': 'rounded-e-lg',
      'rounded-tl-sm': 'rounded-ss-sm',
      'rounded-l': 'rounded-s',
      'border-l': 'border-s',
      'border-l-4': 'border-s-4',
      'float-left': 'float-start',
      'scroll-ml-2': 'scroll-ms-2',
      '!pl-2': '!ps-2',
      '!ml-2': '!ms-2',
      'ml-2!': 'ms-2!',
      'md:!-mr-1': 'md:!-me-1',
      'text-left!': 'text-start!',
      'hover:mr-1': 'hover:me-1',
    };
    for (const [physical, logical] of Object.entries(cases)) {
      assert.equal(logicalReplacement(physical), logical, physical);
    }
    for (const fine of ['ms-2', 'inset-x-0', 'text-start', 'leading-ar-normal', 'border', 'mx-2']) {
      assert.equal(logicalReplacement(fine), undefined, fine);
    }
  });
});
