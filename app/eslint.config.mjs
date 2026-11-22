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
    files: ["src/lib/table/**/*.ts"],
    ignores: ["src/lib/table/motion/verbs.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BANNED_IN_LIB, ...SCALE_ONLY_IN_VERBS],
    },
  },
]);
