import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { checkWorkerPreflight, PAGES_ORIGIN } from "../scripts/check-worker-preflight.mjs";
import { resolveWorkerOrigin } from "../scripts/worker-origin.mjs";

const repository = process.env.GITHUB_REPOSITORY;

test("Pages publication requires a valid HTTPS Worker origin", () => {
    assert.throws(() => resolveWorkerOrigin("", { required: true }), /must be set/);
    for (const value of ["http://mak.example", "https://mak.example/api", "https://user:pass@mak.example"]) {
        assert.throws(() => resolveWorkerOrigin(value), /HTTPS origin/);
    }
    for (const value of ["https://worker.example.test", "https://example.com", "https://localhost"]) {
        assert.throws(() => resolveWorkerOrigin(value), /reserved/);
    }
    assert.equal(resolveWorkerOrigin("https://mak-worker-fixture.com/", { required: true }), "https://mak-worker-fixture.com");
    const workflow = readFileSync(".github/workflows/deploy-pages.yml", "utf8");
    assert.match(workflow, /node scripts\/validate-pages-origin\.mjs/);
    assert.match(workflow, /node scripts\/check-worker-preflight\.mjs/);
    assert.match(workflow, /MAK_REQUIRE_WORKER_ORIGIN: "true"/);
});

test("Pages deployment checks Worker CORS through a read-only preflight", async () => {
    const calls = [];
    const validFetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(null, { status: 204, headers: {
            "Access-Control-Allow-Origin": PAGES_ORIGIN,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, If-None-Match"
        } });
    };
    await checkWorkerPreflight("https://mak-worker-fixture.com", { fetchImpl: validFetch });
    assert.equal(calls[0].url, "https://mak-worker-fixture.com/api/quotes");
    assert.equal(calls[0].options.method, "OPTIONS");
    assert.equal(calls[0].options.headers.Origin, PAGES_ORIGIN);
    assert.equal(calls[0].options.headers["Access-Control-Request-Method"], "POST");
    assert.equal(calls[0].options.headers["Access-Control-Request-Headers"], "content-type");
    await assert.rejects(checkWorkerPreflight("https://mak-worker-fixture.com", {
        fetchImpl: async () => new Response(null, { status: 204 })
    }), /did not allow the GitHub Pages origin/);
});

test("build emits resized JPEGs using the cross-platform optimizer", async () => {
    const source = await sharp("images/hero.jpg").metadata();
    const built = await sharp("dist/images/hero.jpg").metadata();
    assert.equal(built.format, "jpeg");
    assert.ok(built.width <= 1400);
    assert.ok(built.width <= source.width);
    assert.ok(statSync("dist/images/hero.jpg").size < statSync("images/hero.jpg").size);
});

test("GitHub Pages rewrites the legacy pricing redirect to the project catalog route", { skip: !repository }, () => {
    const pricing = readFileSync("dist/pages/pricing.html", "utf8");
    assert.match(pricing, new RegExp(`url=/${repository.split("/")[1]}/products\\.html`));
    assert.match(pricing, new RegExp(`href="/${repository.split("/")[1]}/products\\.html"`));
});

test("GitHub Pages sitemap lists the site and every catalog product", { skip: !repository }, () => {
    const [owner, name] = repository.split("/");
    const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
    const sitemap = readFileSync("dist/pages/sitemap.xml", "utf8");
    const base = `https://${owner}.github.io/${name}`;
    const activeProducts = catalog.products.filter((product) => product.active !== false);

    assert.ok(sitemap.includes(`<loc>${base}/</loc>`));
    assert.ok(sitemap.includes(`<loc>${base}/products.html</loc>`));
    for (const product of activeProducts) {
        assert.ok(sitemap.includes(`${base}/product.html?id=${encodeURIComponent(product.id)}`));
    }
    assert.equal((sitemap.match(/<url>/g) ?? []).length, activeProducts.length + 2);
});

test("GitHub Pages routes resolve from the built artifact in a production-like preview", { skip: !repository }, async (context) => {
    const repositoryName = repository.split("/")[1];
    const basePath = `/${repositoryName}`;
    const pagesRoot = resolve("dist/pages");
    const mimeTypes = {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".jpg": "image/jpeg",
        ".json": "application/json; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".png": "image/png",
        ".txt": "text/plain; charset=utf-8",
        ".webp": "image/webp",
        ".xml": "application/xml; charset=utf-8"
    };
    const server = createServer((request, response) => {
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        } catch {
            response.writeHead(400).end();
            return;
        }
        if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
            response.writeHead(404).end();
            return;
        }

        let relativePath = pathname.slice(basePath.length).replace(/^\/+/, "");
        if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
        const filePath = resolve(pagesRoot, relativePath);
        if (!filePath.startsWith(`${pagesRoot}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
            response.writeHead(404).end();
            return;
        }

        const body = readFileSync(filePath);
        response.writeHead(200, { "content-type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
        response.end(request.method === "HEAD" ? undefined : body);
    });
    await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    context.after(() => new Promise((resolveClose) => server.close(resolveClose)));

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}${basePath}`;
    const catalog = JSON.parse(readFileSync("dist/pages/data/catalog.json", "utf8"));
    const firstProduct = catalog.products.find((product) => product.active !== false);
    const routes = [
        ["/", "text/html", /<title>.*MAK/],
        ["/products.html", "text/html", /products-showcase/],
        [`/product.html?id=${encodeURIComponent(firstProduct.id)}`, "text/html", /id="product-detail"/],
        ["/pricing.html", "text/html", new RegExp(`${basePath}/products\\.html`)],
        ["/data/catalog.json", "application/json", null],
        ["/sitemap.xml", "application/xml", /<urlset/],
        ["/robots.txt", "text/plain", new RegExp(`Sitemap: https://${repository.split("/")[0]}\\.github\\.io/${repositoryName}/sitemap\\.xml`)],
        ["/script.js", "application/javascript", /productHref/],
        ["/images/hero.jpg", "image/jpeg", null]
    ];

    for (const [route, expectedType, expectedContent] of routes) {
        const response = await fetch(`${baseUrl}${route}`);
        assert.equal(response.status, 200, `${route} should resolve from the Pages artifact`);
        assert.ok(response.headers.get("content-type")?.startsWith(expectedType), `${route} should have ${expectedType} content`);
        if (expectedContent) assert.match(await response.text(), expectedContent, `${route} should contain its expected content`);
        else await response.arrayBuffer();
    }

    const missingRoute = await fetch(`${baseUrl}/missing-product-route`);
    assert.equal(missingRoute.status, 404, "the preview must not hide missing files behind an SPA fallback");
});
