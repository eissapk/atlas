/**
 * Runs the behaviour suite in headless Chrome and exits non-zero on failure.
 *
 *   node worldmap/scripts/run-spec.js          (starts its own static server)
 *
 * It drives the browser over the DevTools protocol in REAL time rather than
 * using --virtual-time-budget, because virtual time starves
 * requestAnimationFrame down to ~2 fps and the map's transforms are applied on
 * animation frames. Node's built-in WebSocket is all that is needed.
 *
 * Dev-only: not part of the package's runtime.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const port = 9333;
const serverPort = process.env.PORT || 5178;
const url =
  process.argv[2] ?? `http://localhost:${serverPort}/test/spec.html`;

// Start the static server in-process unless one was pointed at explicitly.
if (!process.argv[2]) {
  process.env.PORT = String(serverPort);
  await import("./serve-demo.js");
  await new Promise((r) => setTimeout(r, 300));
}

const chrome = spawn("chromium", [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  `--remote-debugging-port=${port}`,
  "--window-size=1280,900",
  "--user-data-dir=" + path.join(os.tmpdir(), "worldmap-spec-profile"),
  url,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.includes("spec"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("no debuggable page target appeared");
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Runtime.enable");
const res = await send("Runtime.evaluate", {
  expression: `new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (window.__result) return resolve(window.__result);
      if (Date.now() - started > 90000) return resolve({ timeout: true, log: document.getElementById("out")?.textContent });
      setTimeout(check, 100);
    };
    check();
  })`,
  awaitPromise: true,
  returnByValue: true,
});

const value = res.result?.result?.value;
if (!value) console.log("NO RESULT", JSON.stringify(res).slice(0, 800));
else if (value.timeout) console.log("TIMED OUT. Partial log:\n" + value.log);
else console.log(value.log + `\n${value.pass} passed, ${value.fail} failed`);

ws.close();
chrome.kill();
process.exit(value && !value.timeout && value.fail === 0 ? 0 : 1);
