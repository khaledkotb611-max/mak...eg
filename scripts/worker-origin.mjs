export function resolveWorkerOrigin(value, { required = false } = {}) {
    const origin = String(value ?? "").trim().replace(/\/$/, "");
    if (!origin) {
        if (required) throw new Error("MAK_WORKER_ORIGIN must be set to the deployed Worker HTTPS origin before publishing GitHub Pages.");
        return "";
    }

    let url;
    try {
        url = new URL(origin);
    } catch {
        throw new Error("MAK_WORKER_ORIGIN must be an HTTPS origin without a path.");
    }

    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
        throw new Error("MAK_WORKER_ORIGIN must be an HTTPS origin without a path.");
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const reservedHosts = ["example.com", "example.net", "example.org"];
    const isReservedExampleHost = ["localhost", "test", "example", "invalid"].some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    ) || reservedHosts.some((reserved) => hostname === reserved || hostname.endsWith(`.${reserved}`));
    if (isReservedExampleHost) {
        throw new Error("MAK_WORKER_ORIGIN cannot use a reserved example, test, invalid, or localhost hostname.");
    }

    return origin;
}
