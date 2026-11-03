import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(join(root, "wrangler.jsonc"), "utf8"));

test("Wrangler points to the compiled Worker and the checked-in D1 migrations", () => {
    assert.equal(config.main, "dist/server/index.js");
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.equal(config.d1_databases[0].migrations_dir, ".openai/drizzle");
    assert.equal(config.r2_buckets[0].binding, "BACKUPS");
    assert.equal(config.triggers.crons[0], "*/5 * * * *");
    assert.equal("account_id" in config, false);
});

test("the deployment preflight passes structural checks and blocks the placeholder D1 id", () => {
    const check = spawnSync(process.execPath, ["scripts/check-wrangler-config.mjs"], { cwd: root, encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /Deployment is intentionally blocked/);

    const deployCheck = spawnSync(process.execPath, ["scripts/check-wrangler-config.mjs", "--require-resources"], { cwd: root, encoding: "utf8" });
    assert.notEqual(deployCheck.status, 0);
    assert.match(deployCheck.stderr, /real D1 database ID/);
});
