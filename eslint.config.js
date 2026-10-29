// Lint de prohibiciones (9.1, paso 2 de verify; columna §2). Se aplica a src/**.
import tseslint from 'typescript-eslint';

const RED = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'];
const ALMACEN = ['localStorage', 'sessionStorage'];

const sintaxis = (permitirFetch) => [
  'error',
  { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]", message: 'F-05: prohibido innerHTML/outerHTML/insertAdjacentHTML.' },
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'F-05: prohibido dangerouslySetInnerHTML.' },
  { selector: "Property[key.name='dangerouslySetInnerHTML']", message: 'F-05: prohibido dangerouslySetInnerHTML.' },
  { selector: "AssignmentExpression[left.object.name='document'][left.property.name='title']", message: 'F-03: prohibido document.title =.' },
  { selector: "AssignmentExpression[left.name='location']", message: 'F-03: prohibido asignar location.' },
  { selector: "AssignmentExpression[left.object.name='location']", message: 'F-03: prohibido asignar location.*.' },
  { selector: "AssignmentExpression[left.property.name='location']", message: 'F-03: prohibido asignar *.location.' },
  { selector: "CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.name='location']", message: 'F-03: prohibido navegar con location.' },
  { selector: "CallExpression[callee.property.name=/^(pushState|replaceState)$/]", message: 'F-03: prohibido pushState/replaceState.' },
  { selector: "MemberExpression[property.name=/^(sendBeacon|cookie|write|writeln)$/][object.name=/^(navigator|document)$/]", message: 'F-01/F-05/F-06: API prohibida.' },
  { selector: "MemberExpression[property.name='open'][object.name=/^(window|self|globalThis)$/]", message: 'F-01: prohibido window.open.' },
  { selector: `MemberExpression[property.name=/^(${[...RED, ...ALMACEN].join('|')})$/]`, message: 'F-01/F-06: API prohibida.' },
  ...(permitirFetch ? [] : [
    { selector: "CallExpression[callee.name='fetch']", message: 'F-01: fetch( solo en ner.worker.ts, pdf-read.ts y sw.ts.' },
    { selector: "MemberExpression[property.name='fetch']", message: 'F-01: fetch( solo en ner.worker.ts, pdf-read.ts y sw.ts.' },
  ]),
];

const reglas = (permitirFetch) => ({
  'no-console': 'error',
  'no-debugger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-globals': ['error', ...[...RED, ...ALMACEN, 'open', 'opener'].map((name) => ({ name, message: 'F-01/F-06: global prohibido.' }))],
  'no-restricted-syntax': sintaxis(permitirFetch),
});

const FETCH_PERMITIDO = ['src/workers/ner.worker.ts', 'src/io/pdf-read.ts', 'src/sw.ts'];

export default tseslint.config(
  { ignores: ['**/*', '!src/', '!src/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: 'error', noInlineConfig: true },
    rules: reglas(false),
  },
  { files: FETCH_PERMITIDO, rules: reglas(true) },
);
