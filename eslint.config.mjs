import js from "@eslint/js";
import globals from "globals";

export default [
    { ignores: [".git/**", ".venv/**", "dist/**", "node_modules/**", "vendor/**", "data/**"] },
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.serviceworker,
                D1Database: "readonly",
                $: "readonly",
                api: "readonly",
                authenticated: "readonly",
                lockDashboard: "readonly",
                token: "readonly",
                escapeHtml: "readonly",
                ExcelJS: "readonly",
                adminProducts: "readonly",
                productEtag: "writable",
                adminProductEditor: "readonly",
                loadAdminProducts: "readonly"
            }
        },
        rules: { "no-empty": ["error", { allowEmptyCatch: true }] }
    },
    {
        files: ["scripts/backups-worker.js", "scripts/catalog-worker.js", "scripts/orders-worker.js", "scripts/worker-template.js"],
        rules: { "no-undef": "off", "no-unused-vars": "off" }
    }
];
