// Local server that mirrors the Vercel deployment closely enough for browser
// tests: static files, the response headers from vercel.json (including the
// Content-Security-Policy), and the /api functions. Usage:
//   node scripts/dev-server.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

function applyHeaders(res, pathname) {
  for (const rule of vercel.headers ?? []) {
    const pattern = new RegExp(`^${rule.source.replace("(.*)", ".*")}$`);
    if (pattern.test(pathname))
      for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
}

async function runApi(name, req, res, url) {
  const file = join(root, "api", `${name}.js`);
  const { default: handler } = await import(pathToFileURL(file).href);
  const shim = {
    status(code) {
      res.statusCode = code;
      return shim;
    },
    setHeader(key, value) {
      res.setHeader(key, value);
      return shim;
    },
    json(body) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
      return shim;
    },
  };
  await handler(
    {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
    },
    shim,
  );
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  applyHeaders(res, url.pathname);
  try {
    const api = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (api) return await runApi(api[1], req, res, url);
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) throw Object.assign(new Error(), { code: 404 });
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    const body = await readFile(path);
    res.setHeader(
      "Content-Type",
      TYPES[extname(path)] ?? "application/octet-stream",
    );
    res.end(body);
  } catch {
    if (!res.headersSent) res.statusCode = 404;
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Dev server on http://127.0.0.1:${port}`),
);
