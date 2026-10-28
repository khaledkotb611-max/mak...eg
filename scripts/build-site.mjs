import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const catalogSeed = JSON.parse(await readFile(join(root, "data/catalog.json"), "utf8"));
const ids = new Set();
const catalogImageNames = new Set();
const productCategories = new Set(["pipes", "fittings", "poly"]);
for (const product of catalogSeed.products) {
    if (!product || typeof product.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(product.id)
        || ids.has(product.id) || !productCategories.has(product.category)
        || typeof product.price !== "number" || !Number.isFinite(product.price)
        || product.price < 0 || product.price > 9999999999.99 || Number(product.price.toFixed(2)) !== product.price
        || typeof product.ar?.name !== "string" || !product.ar.name.trim()
        || typeof product.en?.name !== "string" || !product.en.name.trim()
        || (product.active !== undefined && typeof product.active !== "boolean")) throw new Error("Invalid catalog product");
    ids.add(product.id);

    const image = product.image ?? "";
    if (typeof image !== "string" || image.length > 1000) throw new Error(`Invalid image for product ${product.id}`);
    if (/^\/images\/[A-Za-z0-9_.-]+$/.test(image)) {
        const name = image.slice("/images/".length);
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp)$/i.test(name)) throw new Error(`Invalid image for product ${product.id}`);
        catalogImageNames.add(name);
    } else if (image) {
        if (!/^https:\/\/[^\s<>"']+$/.test(image)) throw new Error(`Invalid image for product ${product.id}`);
        let safeRemoteImage = false;
        try {
            const url = new URL(image);
            safeRemoteImage = url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
        } catch {
            // Invalid image URLs are reported with the product ID below.
        }
        if (!safeRemoteImage) throw new Error(`Invalid image for product ${product.id}`);
    }
}
const schemaSource = (await readFile(join(root, "db/schema.ts"), "utf8")).replace("export const", "const");
const execFile = promisify(execFileCallback);

const featuredImageAssets = [
    { name: "hero.jpg", width: 1400, quality: 74 },
    { name: "about.jpg", width: 1200, quality: 72 },
    { name: "ppr.jpg", width: 1100, quality: 72 },
    { name: "pvc.jpg", width: 1100, quality: 72 },
    { name: "value.jpg", width: 1100, quality: 72 }
];
const featuredImageNames = new Set(featuredImageAssets.map(({ name }) => name));
const imageAssets = [
    ...featuredImageAssets,
    ...[...catalogImageNames]
        .filter((name) => !featuredImageNames.has(name))
        .sort()
        .map((name) => ({ name, original: true }))
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

const cacheRevision = "20261028-full-refresh-v1";
for (const pageName of ["index.html", "products.html", "product.html", "pricing.html"]) {
    const pagePath = join(dist, pageName);
    const pageHtml = await readFile(pagePath, "utf8");
    const cacheBustedHtml = pageHtml
        .replace(/(style\.css)\?v=[^"'`]+/g, `$1?v=${cacheRevision}`)
        .replace(/(script\.js)\?v=[^"'`]+/g, `$1?v=${cacheRevision}`);
    await writeFile(pagePath, cacheBustedHtml);
}

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
if (repositoryName) {
    const pages = join(dist, "pages");
    const pagesBase = `/${repositoryName}`;
    const pagesFiles = [
        "index.html",
        "products.html",
        "product.html",
        "pricing.html",
        "style.css",
        "script.js",
        ...imageAssets.map(({ name }) => `images/${name}`)
    ];
    await mkdir(join(pages, "data"), { recursive: true });
    await Promise.all(pagesFiles.map(async (filePath) => {
        const source = await readFile(join(dist, filePath));
        const target = join(pages, filePath);
        await mkdir(dirname(target), { recursive: true });

        if (filePath.startsWith("images/")) {
            await writeFile(target, source);
            return;
        }

        const pageSource = source.toString("utf8")
            .replace(/(["'`])\/(?!\/)([^"'`]*)\1/g, (_, quote, path) => `${quote}${pagesBase}/${path}${quote}`)
            .replaceAll(`${pagesBase}/products"`, `${pagesBase}/products.html"`)
            .replaceAll(`${pagesBase}/products'`, `${pagesBase}/products.html'`)
            .replaceAll(`${pagesBase}/products\``, `${pagesBase}/products.html\``)
            .replace(/<a id="catalog-admin-link"[^>]*>.*?<\/a>/gs, "")
            .replace(/<link\b[^>]*href="[^"]*product-editor\.css[^"]*"[^>]*>/g, "")
            .replace(/<script\b[^>]*src="[^"]*(?:product-editor|catalog-frontend)\.js[^"]*"><\/script>/g, "");
        await writeFile(target, pageSource);
    }));

    const pagesCatalog = structuredClone(catalogSeed);
    pagesCatalog.products = pagesCatalog.products.map((product) => ({
        ...product,
        image: product.image?.startsWith("/") ? `${pagesBase}${product.image}` : product.image
    }));
    await writeFile(join(pages, "data/catalog.json"), `${JSON.stringify(pagesCatalog, null, 2)}\n`);
    await writeFile(join(pages, ".nojekyll"), "");
}

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
