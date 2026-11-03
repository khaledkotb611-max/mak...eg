import { resolveWorkerOrigin } from "./worker-origin.mjs";

export const PAGES_ORIGIN = "https://khaledkotb611-max.github.io";

export async function checkWorkerPreflight(value, { fetchImpl = fetch } = {}) {
    const origin = resolveWorkerOrigin(value, { required: true });
    const response = await fetchImpl(`${origin}/api/quotes`, {
        method: "OPTIONS",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
            Origin: PAGES_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
        }
    });

    if (response.status !== 204) {
        throw new Error(`Worker CORS preflight returned ${response.status}; expected 204.`);
    }
    if (response.headers.get("Access-Control-Allow-Origin") !== PAGES_ORIGIN) {
        throw new Error("Worker CORS preflight did not allow the GitHub Pages origin.");
    }

    const allowedMethods = (response.headers.get("Access-Control-Allow-Methods") || "")
        .split(",").map((method) => method.trim().toUpperCase());
    if (!allowedMethods.includes("POST") || !allowedMethods.includes("OPTIONS")) {
        throw new Error("Worker CORS preflight did not allow POST and OPTIONS.");
    }

    const allowedHeaders = (response.headers.get("Access-Control-Allow-Headers") || "")
        .split(",").map((header) => header.trim().toLowerCase());
    if (!allowedHeaders.includes("content-type")) {
        throw new Error("Worker CORS preflight did not allow the content-type request header.");
    }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
    await checkWorkerPreflight(process.env.MAK_WORKER_ORIGIN);
    console.log("Worker is reachable and allows the GitHub Pages quotation preflight.");
}
