import { resolveWorkerOrigin } from "./worker-origin.mjs";

resolveWorkerOrigin(process.env.MAK_WORKER_ORIGIN, { required: true });
console.log("GitHub Pages Worker origin is configured.");
