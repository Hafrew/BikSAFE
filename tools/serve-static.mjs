import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { createServer } from "node:http";

const root = process.argv.includes("--dist")
  ? join(process.cwd(), "dist", "app")
  : process.cwd();
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] ?? process.env.PORT ?? 8000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requestedPath = normalize(
    decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html",
  );
  const candidate = join(root, requestedPath);
  const rel = relative(root, candidate);

  if (rel.startsWith("..") || rel.includes(":")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let filePath = existsSync(candidate) ? candidate : join(root, "index.html");

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    const fileInfo = await stat(filePath);
    response.writeHead(200, {
      "content-length": fileInfo.size,
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath)
      .on("error", () => {
        if (!response.headersSent) {
          response.writeHead(500);
        }
        response.end("Server error");
      })
      .pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`BikSAFE server running at http://localhost:${port}`);
  console.log(`Serving ${root}`);
});
