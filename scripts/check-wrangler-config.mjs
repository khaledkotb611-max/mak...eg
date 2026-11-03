import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, "wrangler.jsonc");
const config = JSON.parse(await readFile(configPath, "utf8"));
const migrationsPath = join(root, config.d1_databases?.[0]?.migrations_dir || "");
const migrationFiles = (await readdir(migrationsPath)).filter((file) => file.endsWith(".sql")).sort();
const bindingNames = config.d1_databases?.map(({ binding }) => binding) || [];
const bucketBindings = config.r2_buckets?.map(({ binding }) => binding) || [];
const zeroId = "00000000-0000-0000-0000-000000000000";
const databaseId = config.d1_databases?.[0]?.database_id;
const databaseIdIsReady = typeof databaseId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)
    && databaseId !== zeroId;

if (config.main !== "dist/server/index.js") throw new Error("Wrangler main must point to the built Worker at dist/server/index.js.");
if (bindingNames.length !== 1 || bindingNames[0] !== "DB") throw new Error("Configure exactly one D1 binding named DB.");
if (bucketBindings.length !== 1 || bucketBindings[0] !== "BACKUPS") throw new Error("Configure exactly one R2 binding named BACKUPS.");
if (!config.d1_databases[0].database_name || !config.r2_buckets[0].bucket_name) throw new Error("D1 and R2 resource names are required.");
if (!migrationFiles.length || migrationFiles.some((file) => !/^\d{4}_[a-z0-9_-]+\.sql$/.test(file))) {
    throw new Error("D1 migrations must use the four-digit sequence_name.sql format.");
}
for (let index = 0; index < migrationFiles.length; index++) {
    const expectedPrefix = `${String(index).padStart(4, "0")}_`;
    if (!migrationFiles[index].startsWith(expectedPrefix)) throw new Error(`Migration sequence gap or order issue at ${migrationFiles[index]}.`);
}

const configText = JSON.stringify(config).toUpperCase();
if (/ADMIN_TOKEN|RESEND_API_KEY|API_KEY|SECRET|PASSWORD/.test(configText)) {
    throw new Error("Secrets must not be stored anywhere in wrangler.jsonc. Use Cloudflare Worker secrets instead.");
}

if (process.argv.includes("--require-resources")) {
    if (!databaseIdIsReady) throw new Error("Set d1_databases[0].database_id to the real D1 database ID returned by Cloudflare before deploying.");
    if (config.r2_buckets[0].bucket_name === "mak-company-backups") {
        console.log("Using the proposed R2 name; confirm that this bucket exists in the intended Cloudflare account before deploying.");
    }
} else if (!databaseIdIsReady) {
    console.log("Wrangler config structure is valid. Deployment is intentionally blocked until a real D1 database ID is entered.");
}

console.log(`Wrangler config OK: ${migrationFiles.length} ordered D1 migrations, DB and BACKUPS bindings.`);
