import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const catalogSeed = JSON.parse(await readFile(join(root, "data/catalog.json"), "utf8"));
const ids = new Set();
for (const product of catalogSeed.products) {
    if (ids.has(product.id) || !product.id || !Number.isFinite(product.price) || product.price < 0 || !product.ar?.name || !product.en?.name) throw new Error("Invalid catalog product");
    ids.add(product.id);
}
const schemaSource = (await readFile(join(root, "db/schema.ts"), "utf8")).replace("export const", "const");
const execFile = promisify(execFileCallback);

const imageAssets = [
    { name: "hero.jpg", width: 1400, quality: 74 },
    { name: "about.jpg", width: 1200, quality: 72 },
    { name: "ppr.jpg", width: 1100, quality: 72 },
    { name: "pvc.jpg", width: 1100, quality: 72 },
    { name: "value.jpg", width: 1100, quality: 72 },
    { name: "pvc-access-elbow.jpeg", original: true },
    { name: "pvc-elbow-90.jpeg", original: true },
    { name: "pvc-elbow-45.jpeg", original: true },
    { name: "pvc-vent.jpeg", original: true },
    { name: "pvc-coupling.jpeg", original: true }
];

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
};

await rm(dist, { force: true, recursive: true });
await mkdir(join(dist, "server"), { recursive: true });
await mkdir(join(dist, "images"), { recursive: true });
await mkdir(join(dist, "vendor"), { recursive: true });

const optimizeImage = async ({ name, width, quality, original = false }) => {
    const source = join(root, "images", name);
    const target = join(dist, "images", name);

    if (original) { await cp(source, target); return; }

    try {
        await execFile("sips", [
            "--resampleWidth",
            String(width),
            "--setProperty",
            "format",
            "jpeg",
            "--setProperty",
            "formatOptions",
            String(quality),
            source,
            "--out",
            target
        ]);
    } catch {
        await cp(source, target);
    }
};

await Promise.all([
    cp(join(root, "index.html"), join(dist, "index.html")),
    ...["admin.html", "admin.css", "admin.js", "catalog-admin.js", "product-editor.js", "catalog-frontend.js", "product-editor.css"].map(file=>cp(join(root,file),join(dist,file))),
    cp(join(root,"vendor/exceljs-4.4.0.min.js"),join(dist,"vendor/exceljs-4.4.0.min.js")),
    cp(join(root, "products.html"), join(dist, "products.html")),
    cp(join(root, "product.html"), join(dist, "product.html")),
    cp(join(root, "pricing.html"), join(dist, "pricing.html")),
    cp(join(root, "style.css"), join(dist, "style.css")),
    cp(join(root, "script.js"), join(dist, "script.js")),
    ...imageAssets.map(optimizeImage)
]);

const assetFiles = [
    "index.html",
    "admin.html", "admin.css", "admin.js", "catalog-admin.js", "product-editor.js", "catalog-frontend.js", "product-editor.css",
    "vendor/exceljs-4.4.0.min.js",
    "products.html",
    "product.html",
    "pricing.html",
    "style.css",
    "script.js",
    ...imageAssets.map(({ name }) => `images/${name}`)
];

const assets = Object.fromEntries(await Promise.all(assetFiles.map(async (filePath) => {
    const content = await readFile(join(dist, filePath));
    const extension = extname(filePath).toLowerCase();

    return [`/${filePath}`, {
        body: content.toString("base64"),
        contentType: contentTypes[extension] || "application/octet-stream"
    }];
})));

const adminSource = await readFile(join(root,"scripts/orders-worker.js"),"utf8");
const backupSource = await readFile(join(root,"scripts/backups-worker.js"),"utf8");
const template = await readFile(join(root, "scripts/worker-template.js"), "utf8");
const catalogSource = await readFile(join(root,"scripts/catalog-worker.js"),"utf8");
const worker = `const assets = ${JSON.stringify(assets)};\nconst catalogSeed = ${JSON.stringify(catalogSeed)};\n${schemaSource}\n${adminSource}\n${backupSource}\n${catalogSource}\n${template}`;
await mkdir(join(dist, ".openai", "drizzle"), { recursive: true });
await cp(join(root, ".openai/hosting.json"), join(dist, ".openai/hosting.json"));
await cp(join(root, ".openai/drizzle"), join(dist, ".openai/drizzle"), { recursive: true });

await writeFile(join(dist, "server", "index.js"), worker);

const html = await readFile(join(dist, "index.html"), "utf8");
if (!html.includes("MAK Plumbing Solutions")) {
    throw new Error("Build verification failed: index.html is missing the site title.");
}
