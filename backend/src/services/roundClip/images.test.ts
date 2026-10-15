import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { imageToDataUri } from "./images.js";

// A 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("no URL gives no image", async () => {
  assert.equal(await imageToDataUri(null), null);
});

test("an unreachable host gives no image instead of throwing", async () => {
  const started = Date.now();
  assert.equal(await imageToDataUri("http://127.0.0.1:9/x.png", 500), null);
  assert.ok(Date.now() - started < 3000);
});

test("a served PNG comes back as a data URI", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const uri = await imageToDataUri(`http://127.0.0.1:${port}/logo.png`);
    assert.ok(uri?.startsWith("data:image/png;base64,"));
  } finally {
    server.close();
  }
});

test("a non-image response gives no image", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    assert.equal(await imageToDataUri(`http://127.0.0.1:${port}/page`), null);
  } finally {
    server.close();
  }
});
