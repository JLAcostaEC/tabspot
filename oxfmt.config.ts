import { defineConfig } from "oxfmt";

export default defineConfig({
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    quoteProps: "as-needed",
    trailingComma: "all",
    bracketSpacing: true,
    bracketSameLine: false,
    arrowParens: "always",
    endOfLine: "lf",
    ignorePatterns: ["**/*.d.ts", "**/*.min.js", "pnpm-lock.yaml", "CHANGELOG.md", "dist", ".changeset", ".claude"],
});
