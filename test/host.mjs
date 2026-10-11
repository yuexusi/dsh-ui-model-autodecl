#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = await import("../lib/index.js");
if (plugin.name !== "model-autodecl") throw new Error("unexpected name");

const routes = [];
let section = null;
const updates = [];
let currentProviders = {
	w: {
		models: [
			{ id: "model-a" },
			{ id: "model-b", input: ["text", "image"] },
			{ id: "model-c", contextWindow: 64000 },
		],
	},
};
let revision = 5;
const ctx = {
	effect: (fn) => { fn(); return () => {}; },
	inject: (_l, cb) => { cb(ctx); return () => {}; },
	systemPrompt: { section: (s) => { section = s; return () => {}; } },
	webServer: { register: (r) => { routes.push(r); return () => {}; } },
	connection: { admit: () => ({ peer: {} }) },
	settings: {
		describe: () => [{ ns: "llm-pi-ai", revision, user: { providers: currentProviders } }],
		update: async (ns, patch, expected) => {
			if (expected !== revision) throw new Error("revision mismatch");
			updates.push({ ns, patch, expected });
			revision += 1;
			currentProviders = patch.providers;
		},
	},
	logger: { info: () => {}, warn: () => {} },
};
plugin.apply(ctx);
if (routes.length !== 1 || routes[0].path !== "/model-autodecl") throw new Error("route missing");
if (section === null || section.name !== "model-autodecl") throw new Error("section missing");

// startup fill is async — give it a tick
await new Promise((resolve) => setTimeout(resolve, 20));
if (updates.length !== 1) throw new Error("startup fill wrote once: " + updates.length);
const patched = updates[0].patch.providers.w.models;
if (patched[0].input === undefined || patched[0].contextWindow !== 128000 || patched[0].maxTokens !== 8192) throw new Error("model-a filled: " + JSON.stringify(patched[0]));
if (patched[1].input.length !== 2 || patched[1].contextWindow !== 128000) throw new Error("model-b keeps input, fills contextWindow");
if (patched[2].contextWindow !== 64000 || patched[2].maxTokens !== 8192) throw new Error("model-c keeps contextWindow, fills maxTokens");
if (!section.text().includes("filled 3")) throw new Error("section reports fill count");

// rescan on an already-complete layer is a no-op
class FakeReq {
	constructor(body) { this.method = "POST"; this.headers = { "content-type": "application/json" }; this.body = body; }
	on(e, cb) { if (e === "data") this.dc = cb; if (e === "end") this.ec = cb; if (e === "error") setTimeout(() => { if (this.body !== undefined) this.dc?.(Buffer.from(this.body)); this.ec?.(); }, 0); return this; }
	destroy() {}
}
const drive = async (endpoint, payload) => {
	const req = new FakeReq(JSON.stringify({ type: "client-request", rpcId: "t", method: endpoint, payload: payload ?? {} }));
	const res = { status: 0, body: "" };
	res.writeHead = (s) => { res.status = s; };
	res.end = (b) => { res.body = b ?? ""; };
	await routes[0].handler(req, res);
	if (res.status !== 200) throw new Error(endpoint + " -> " + res.status + " " + res.body);
	return JSON.parse(res.body).result;
};
const before = updates.length;
const rescan = await drive("rescan", {});
if (rescan.value.lastFill.filled !== 0) throw new Error("complete layer: no refill");
if (updates.length !== before) throw new Error("no redundant write");

// a new undeclared model gets filled on rescan
currentProviders.w.models.push({ id: "model-d" });
const rescan2 = await drive("rescan", {});
if (rescan2.value.lastFill.filled !== 1) throw new Error("model-d filled on rescan");
const latest = updates.at(-1).patch.providers.w.models.find((m) => m.id === "model-d");
if (latest.input === undefined || latest.contextWindow !== 128000) throw new Error("model-d carries defaults");

const disabled = await drive("set", { enabled: false });
if (disabled.value.enabled !== false) throw new Error("disable");
if (section.text() !== "") throw new Error("disabled section renders nothing");

console.log("ALL MODEL-AUTODECL HOST CHECKS PASSED");
