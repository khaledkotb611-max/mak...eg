import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.serviceworker,
                D1Database: "readonly"
            }
        },
        rules: { "no-empty": ["error", { allowEmptyCatch: true }] }
    }
];
