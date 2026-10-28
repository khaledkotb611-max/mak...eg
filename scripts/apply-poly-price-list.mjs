import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(root, "data/catalog.json");
const sourcePath = join(root, "data/poly-price-list.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const priceList = JSON.parse(await readFile(sourcePath, "utf8"));
const finishes = [
    { key: "green", ar: "أخضر", en: "Green", index: 1 },
    { key: "insulated", ar: "معزول", en: "Insulated", index: 2 }
];
const legacyIds = {
    "valve-concealed:25:green": "ppr-fitting-concealed-valve-green-25-mm",
    "union-female:32:green": "ppr-fitting-female-union-green-32-mm",
    "union-female:32:insulated": "ppr-fitting-female-union-insulated-32-mm"
};
const slug = (value) => value
    .replaceAll("*", "-")
    .replaceAll(" ", "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
const formatSize = (value, unit) => `${value.trim().replace(/\s*\*\s*/g, " × ")} ${unit}`;
const entries = [];

for (const item of priceList.items) {
    const variants = item.variants || finishes.map((finish) => [
        finish.key, finish.ar, finish.en, finish.index
    ]);

    for (const row of item.rows) {
        const [size, ...prices] = row;
        const sizeAr = formatSize(size, "مم");
        const sizeEn = formatSize(size, "mm");
        for (const [variantKey, finishAr, finishEn, priceIndex] of variants) {
            const price = prices[priceIndex - 1];
            if (price == null) continue;

            const matchKey = `${item.id}:${size}:${variantKey}`;
            const productId = legacyIds[matchKey]
                || `poly-list-${item.id}-${slug(size)}-${variantKey}`;
            const sizeLabel = /^\d+$/.test(size) ? `${size} مم` : `${size} مم`;
            const categoryAr = item.category[0];
            const categoryEn = item.category[1];
            const image = `/images/${item.image || "value.jpg"}`;
            const nameAr = item.name[0];
            const nameEn = item.name[1];
            entries.push({
                id: productId,
                category: "poly",
                image,
                price,
                ar: {
                    name: nameAr,
                    category: categoryAr,
                    size: sizeAr,
                    spec: item.spec[0],
                    unit: "قطعة",
                    finish: finishAr,
                    description: `${nameAr} مقاس ${sizeAr} - ${finishAr}. السعر للقطعة الواحدة حسب قائمة أسعار البولي بتاريخ ${priceList.updatedAt}.`
                },
                en: {
                    name: nameEn,
                    category: categoryEn,
                    size: sizeEn,
                    spec: item.spec[1],
                    unit: "piece",
                    finish: finishEn,
                    description: `${nameEn}, size ${sizeEn}, ${finishEn}. Per-piece price from the PPR list dated ${priceList.updatedAt}.`
                }
            });
        }
    }
}

const products = new Map(catalog.products.map((product) => [product.id, product]));
for (const product of entries) products.set(product.id, product);
catalog.products = [...products.values()];
catalog.updatedAt = priceList.updatedAt;
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Applied ${entries.length} PPR prices; catalog now contains ${catalog.products.length} products.`);
