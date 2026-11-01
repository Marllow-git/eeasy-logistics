// eeasy/no-physical-direction-utilities (WEB-1 plan 2.3; web §5; ADR-0033): Arabic is the primary
// layout, so class strings use logical Tailwind utilities only. The rule reads every string and
// template literal inside a `className` or `class` attribute and inside `cn(`, `cva(` and `tv(`
// calls (nested conditionals, arrays and variant objects included) and reports physical-direction
// utilities with their logical replacement. Variant prefixes (`md:`, `hover:`, `rtl:`), the
// important mark and a negative sign are looked through: `rtl:ml-2` is still physical.

/** Physical utility prefix → logical replacement. Longest prefixes first. */
const replacements = [
  ['scroll-ml-', 'scroll-ms-'],
  ['scroll-mr-', 'scroll-me-'],
  ['scroll-pl-', 'scroll-ps-'],
  ['scroll-pr-', 'scroll-pe-'],
  ['rounded-tl-', 'rounded-ss-'],
  ['rounded-tr-', 'rounded-se-'],
  ['rounded-bl-', 'rounded-es-'],
  ['rounded-br-', 'rounded-ee-'],
  ['rounded-l-', 'rounded-s-'],
  ['rounded-r-', 'rounded-e-'],
  ['border-l-', 'border-s-'],
  ['border-r-', 'border-e-'],
  ['left-', 'start-'],
  ['right-', 'end-'],
  ['ml-', 'ms-'],
  ['mr-', 'me-'],
  ['pl-', 'ps-'],
  ['pr-', 'pe-'],
];

/** Whole utilities that have no value part (`border-l` alone, `text-left`). */
const exact = new Map([
  ['text-left', 'text-start'],
  ['text-right', 'text-end'],
  ['float-left', 'float-start'],
  ['float-right', 'float-end'],
  ['clear-left', 'clear-start'],
  ['clear-right', 'clear-end'],
  ['rounded-l', 'rounded-s'],
  ['rounded-r', 'rounded-e'],
  ['rounded-tl', 'rounded-ss'],
  ['rounded-tr', 'rounded-se'],
  ['rounded-bl', 'rounded-es'],
  ['rounded-br', 'rounded-ee'],
  ['border-l', 'border-s'],
  ['border-r', 'border-e'],
]);

const classAttributes = new Set(['className', 'class']);
const classCallees = new Set(['cn', 'clsx', 'cva', 'tv']);
/** clsx-style callees, where an object key is a class name (`cn({ 'ms-4': active })`). */
const objectKeyCallees = new Set(['cn', 'clsx']);

/**
 * The logical replacement for a physical utility, or undefined when the class is not physical.
 * @param {string} className
 * @returns {string | undefined}
 */
export function logicalReplacement(className) {
  const variants = className.split(':');
  let utility = variants.pop() ?? '';
  utility = utility.replace(/^!/, '').replace(/!$/, '');
  const negative = utility.startsWith('-');
  if (negative) utility = utility.slice(1);
  const sign = negative ? '-' : '';
  const prefix = variants.length ? `${variants.join(':')}:` : '';
  const whole = exact.get(utility);
  if (whole) return `${prefix}${sign}${whole}`;
  for (const [physical, logical] of replacements) {
    if (utility.startsWith(physical) && utility.length > physical.length) {
      return `${prefix}${sign}${logical}${utility.slice(physical.length)}`;
    }
  }
  return undefined;
}

/** @param {import('estree').Node & { parent?: import('estree').Node }} node */
function isInClassContext(node) {
  // An object key is a class name only for clsx-style callees (`cn({ 'ms-4': active })`); under
  // cva and tv it names a variant (`{ side: { start: … } }`) and is not checked.
  let isObjectKey = false;
  for (
    let child = node, current = node.parent;
    current;
    child = current, current = current.parent
  ) {
    if (current.type === 'JSXAttribute') {
      const name = current.name.type === 'JSXIdentifier' ? current.name.name : '';
      return !isObjectKey && classAttributes.has(name);
    }
    if (current.type === 'CallExpression') {
      const { callee } = current;
      if (callee.type === 'Identifier' && classCallees.has(callee.name)) {
        return !isObjectKey || objectKeyCallees.has(callee.name);
      }
    }
    if (current.type === 'Property' && current.key === child) {
      // Only a key of an object passed straight to the call counts; a nested key is a variant.
      const call = current.parent?.parent;
      if (isObjectKey || call?.type !== 'CallExpression') return false;
      isObjectKey = true;
    }
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'Program' ||
      current.type === 'JSXElement'
    ) {
      return false;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noPhysicalDirectionUtilities = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow physical-direction Tailwind utilities; use the logical ones (web §5, ADR-0033).',
    },
    messages: {
      physical:
        '"{{physical}}" is a physical-direction utility; use "{{logical}}" so the layout mirrors in Arabic (web §5).',
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {string} text
     */
    function check(node, text) {
      if (!isInClassContext(node)) return;
      for (const className of text.split(/\s+/)) {
        if (!className) continue;
        const logical = logicalReplacement(className);
        if (logical) {
          context.report({ node, messageId: 'physical', data: { physical: className, logical } });
        }
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
