import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = process.env.GITHUB_REPOSITORY;

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
