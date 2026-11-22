import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const BANNED_SYNTAX = [
  {
    selector: "CallExpression[callee.name='useEffect']",
    message: "useEffect is banned. Mount through a ref callback and read stores with useSyncExternalStore.",
  },
  {
    selector: "MemberExpression[property.name='useEffect']",
    message: "useEffect is banned. Mount through a ref callback and read stores with useSyncExternalStore.",
  },
  {
    selector: "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
    message: "`as unknown as` is banned. Fix the type.",
  },
];

const BANNED_IN_LIB = [
  ...BANNED_SYNTAX,
  {
    selector: "ThrowStatement",
    message: "No throw in lib/. Return a result value: { ok: true, ... } | { ok: false, reason }.",
  },
];

const SCALE_ONLY_IN_VERBS = [
  {
    selector: "AssignmentExpression[left.object.property.name='scale']",
    message: "Nothing scales outside the paper verbs (plan/07 section 12, item 7). Use src/lib/table/motion/verbs.ts.",
  },
  {
    selector: "CallExpression[callee.object.property.name='scale']",
    message: "Nothing scales outside the paper verbs (plan/07 section 12, item 7). Use src/lib/table/motion/verbs.ts.",
  },
];

const REQUESTS_THROUGH_RPC = [
  {
    selector: "CallExpression[callee.name='fetch']",
    message: "Every request needs a deadline: use fetchWithTimeout from src/lib/chain/rpc.ts.",
  },
  {
    selector: "NewExpression[callee.name='Connection']",
    message: "Every RPC call needs a deadline: use createRpcConnection from src/lib/chain/rpc.ts.",
  },
  {
    selector: "CallExpression[callee.property.name='serialize']:not(CallExpression[callee.name=/^attempt(Sync)?$/] CallExpression)",
    message: "Transaction.serialize throws on a missing signer or an oversized transaction: call it inside attemptSync (src/lib/chain/result.ts) or use serializeTransaction.",
  },
];

const PER_FRAME_FUNCTION = ":matches(FunctionDeclaration, FunctionExpression)[id.name!=/^(build|create|print|make)[A-Z]/]";
const STEP_CALLBACK = "CallExpression[callee.property.name='onStep']";
const PER_FRAME_ALLOCATION_MESSAGE =
  "Replay and motion code runs every frame: allocate in a build*/create*/print*/make* function and reuse it (a module scratch vector, an `out` parameter, a precomputed table).";
const NO_ALLOCATION_PER_FRAME = [
  { selector: `${PER_FRAME_FUNCTION} NewExpression[callee.object.name='THREE']`, message: PER_FRAME_ALLOCATION_MESSAGE },
  { selector: `${PER_FRAME_FUNCTION} NewExpression[callee.name=/^(Map|Set)$/]`, message: PER_FRAME_ALLOCATION_MESSAGE },
  { selector: `${PER_FRAME_FUNCTION} CallExpression[callee.property.name='clone']`, message: PER_FRAME_ALLOCATION_MESSAGE },
  { selector: `${STEP_CALLBACK} NewExpression[callee.object.name='THREE']`, message: PER_FRAME_ALLOCATION_MESSAGE },
  { selector: `${STEP_CALLBACK} NewExpression[callee.name=/^(Map|Set)$/]`, message: PER_FRAME_ALLOCATION_MESSAGE },
  { selector: `${STEP_CALLBACK} CallExpression[callee.property.name='clone']`, message: PER_FRAME_ALLOCATION_MESSAGE },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/lib/papercraft/**/*.js"]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "id-length": ["error", { min: 2, properties: "never" }],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useEffect"],
              message: "useEffect is banned. Mount through a ref callback and read stores with useSyncExternalStore.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...BANNED_SYNTAX],
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_IN_LIB],
    },
  },
  {
    files: ["src/lib/chain/**/*.ts", "src/lib/game/**/*.ts", "src/app/api/**/*.ts", "scripts/**/*.ts"],
    ignores: ["**/*.test.ts", "src/lib/chain/rpc.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_IN_LIB, ...REQUESTS_THROUGH_RPC],
    },
  },
  {
    files: ["src/lib/table/**/*.ts"],
    ignores: ["src/lib/table/motion/verbs.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_IN_LIB, ...SCALE_ONLY_IN_VERBS],
    },
  },
  {
    files: ["src/lib/table/replay/**/*.ts", "src/lib/table/motion/**/*.ts"],
    ignores: ["**/*.test.ts", "src/lib/table/motion/verbs.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_IN_LIB, ...SCALE_ONLY_IN_VERBS, ...NO_ALLOCATION_PER_FRAME],
    },
  },
]);
