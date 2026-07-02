import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const legacyExplicitAnyFiles = [
  "app/api/(webhooks)/blip/contacts/route.ts",
  "app/api/dashboard/conversas/route.ts",
  "app/api/dashboard/executivo/route.ts",
  "app/api/dashboard/jornada/route.ts",
  "app/api/inbox/threads/[threadId]/route.ts",
  "app/eventos/page.tsx",
  "components/conversations/ConversationPanel.tsx",
  "lib/ai/analyzeConversation.ts",
  "lib/importers/blip/parseBlipMessage.ts",
];

const legacyReactCompilerFiles = [
  "components/conversations/ConversationPanel.tsx",
  "components/conversations/FloatingConversationPanel.tsx",
  "components/inbox/InboxPrewrittenMessagesController.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing screens intentionally initialize/reset local UI state from
      // effects. Keep this visible while allowing the project to migrate safely.
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: legacyExplicitAnyFiles,
    rules: {
      // Keep legacy boundary typing visible without disabling the rule for new
      // files. These warnings should be replaced with validated DTOs over time.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: legacyReactCompilerFiles,
    rules: {
      // These large legacy orchestration components need focused refactors.
      // New files still fail on React immutability violations.
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      // Maintenance scripts are currently CommonJS and run directly with Node.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "app/dev/ui/uiRegistry.generated.tsx",
  ]),
]);

export default eslintConfig;
