/**
 * dsh-ui-model-autodecl host entry.
 *
 * Fills missing pi-ai model capability declarations (input modality,
 * context window, output cap) into the settings user layer without touching
 * existing values, rescans on demand over an authenticated JSON channel,
 * and contributes a prompt section that tells the model which of its
 * route capabilities are plugin-declared defaults.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Cordis plugin identity. */
export const name = "model-autodecl";

//#region defaults
/** Defaults this plugin fills; existing user declarations always win. */
export const DEFAULTS = Object.freeze({
	input: ["text"],
	contextWindow: 128000,
	maxTokens: 8192,
});

/**
 * Relay-safe compat matrix for openai-completions routes: values that match
 * what mainstream OpenAI-compatible aggregators and the official NVIDIA
 * endpoint actually implement. Only keys MISSING from a model's compat block
 * are filled; existing keys (including the adapter-inherited absence) win.
 * Deliberately NOT filled: supportsDeveloperRole (either value can break a
 * relay), thinkingFormat / cacheControlFormat / vllmPriority /
 * thinkingTokenBudgetField (protocol- or runtime-specific).
 */
export const COMPAT_DEFAULTS = Object.freeze({
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	supportsFinishReason: true,
	maxTokensField: "max_tokens",
	supportsThinkingTokenBudget: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	supportsStrictMode: false,
	supportsStore: false,
});

/** Read the llm-pi-ai descriptor user-layer providers. */
function userProviders(settings) {
	for (const descriptor of settings.describe({ redactSecrets: true })) {
		if (descriptor?.ns !== "llm-pi-ai") continue;
		return descriptor.user?.providers ?? null;
	}
	return null;
}

/**
 * Fill missing declarations on the user layer own model entries.
 * Only entries the user layer carries are writable (the same rule
 * the thinking-effort plugin applies for effort levels).
 * @returns patch carriers, or null when nothing changed.
 */
function filledProviders(providers) {
	let changed = false;
	const filled = [];
	const next = {};
	for (const [providerId, profile] of Object.entries(providers)) {
		if (profile === null || typeof profile !== "object" || !Array.isArray(profile.models)) { next[providerId] = profile; continue; }
		const models = profile.models.map((model) => {
			if (model === null || typeof model !== "object" || typeof model.id !== "string" || model.id === "") return model;
			const patch = {};
			// An explicit empty array declares "no modality", which the UI then
			// renders through fallbacks; normalize it to the text-only default.
			if (model.input === undefined || (Array.isArray(model.input) && model.input.length === 0)) patch.input = DEFAULTS.input;
			if (model.contextWindow === undefined) patch.contextWindow = DEFAULTS.contextWindow;
			if (model.maxTokens === undefined) patch.maxTokens = DEFAULTS.maxTokens;
			// Compat: fill only keys MISSING from the model's compat block.
			if (model.compat === undefined || typeof model.compat !== "object") {
				patch.compat = { ...COMPAT_DEFAULTS };
			} else {
				const compatPatch = {};
				for (const [key, value] of Object.entries(COMPAT_DEFAULTS)) {
					if (model.compat[key] === undefined) compatPatch[key] = value;
				}
				if (Object.keys(compatPatch).length > 0) patch.compat = { ...model.compat, ...compatPatch };
			}
			if (Object.keys(patch).length === 0) return model;
			changed = true;
			const parts = [];
			if (patch.input !== undefined) parts.push("input");
			if (patch.contextWindow !== undefined) parts.push("contextWindow");
			if (patch.maxTokens !== undefined) parts.push("maxTokens");
			if (patch.compat !== undefined) parts.push("compat(" + Object.keys(patch.compat).filter((k) => model.compat === undefined || model.compat[k] === undefined).length + ")");
			filled.push(providerId + "/" + model.id + ": " + parts.join(", "));
			return { ...model, ...patch };
		});
		next[providerId] = { ...profile, models };
	}
	return changed ? { providers: next, filled } : null;
}
//#endregion

//#region prompt
/** Tell the model when its route capabilities are plugin defaults. */
function renderSection(filledCount, enabled) {
	if (!enabled || filledCount === 0) return "";
	return [
		"## Model capability declarations",
		"",
		"The dsh-ui-model-autodecl plugin filled " + String(filledCount) + " model declaration(s) (input modality, context window, output cap) with conservative defaults: input is text-only unless declared otherwise, context window 128k, output cap 8192. Treat image input as unavailable and avoid long-context assumptions for those routes; the user can correct any of this on the Models settings page.",
	].join("\n");
}
//#endregion

//#region rpc
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1024 * 1024) { reject(new Error("request body too large")); req.destroy(); return; }
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function makeRpcRouteHandler(connectionCtx, handle) {
	return async (req, res) => {
		const write = (status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
		try {
			const admission = connectionCtx.connection.admit(req);
			if ("rejection" in admission) { res.writeHead(admission.rejection); res.end(admission.rejection === 401 ? "unauthorized" : "forbidden"); return; }
			if (req.method !== "POST") { write(405, { error: "method not allowed" }); return; }
			if ((req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") { write(415, { error: "content type must be application/json" }); return; }
			let message;
			try { message = JSON.parse(await readBody(req)); } catch { write(400, { error: "body is not JSON" }); return; }
			if (message === null || typeof message !== "object" || message.type !== "client-request" || typeof message.rpcId !== "string" || message.rpcId === "" || typeof message.method !== "string") {
				write(400, { type: "server-response", rpcId: "invalid-request", result: { ok: false, error: { code: "gateway/bad-request", message: "invalid client-request message" } } });
				return;
			}
			const result = await handle(message.method, message.payload ?? {});
			write(200, { type: "server-response", rpcId: message.rpcId, result });
		} catch (error) {
			write(500, { error: "rpc failure: " + String(error instanceof Error ? error.message : error) });
		}
	};
}
//#endregion

//#region body
export function apply(ctx) {
	let filledCount = 0;
	let enabled = true;

	/** One fill pass over the current user layer. */
	const runFill = async () => {
		const providers = userProviders(ctx.settings);
		if (providers === null) return { filled: 0, entries: [] };
		const patch = filledProviders(providers);
		if (patch === null) return { filled: 0, entries: [] };
		for (const descriptor of ctx.settings.describe({ redactSecrets: true })) {
			if (descriptor?.ns !== "llm-pi-ai") continue;
			await ctx.settings.update("llm-pi-ai", { providers: patch.providers }, descriptor.revision);
			break;
		}
		filledCount += patch.filled.length;
		return { filled: patch.filled.length, entries: patch.filled };
	};

	runFill().then((outcome) => {
		ctx.logger?.info?.("model-autodecl: startup fill %d entries", outcome.filled);
	}, (error) => {
		ctx.logger?.warn?.("model-autodecl: startup fill failed: %s", String(error?.message ?? error));
	});

	ctx.systemPrompt.section({
		name: "model-autodecl",
		order: 9420,
		text: () => renderSection(filledCount, enabled),
	});

	const handleRpc = async (endpoint, payload) => {
		try {
			switch (endpoint) {
				case "get":
					return { ok: true, value: { enabled, filled: filledCount, defaults: DEFAULTS } };
				case "rescan": {
						const outcome = await runFill();
						return { ok: true, value: { enabled, filled: filledCount, lastFill: outcome } };
				}
				case "set": {
						if (payload !== null && typeof payload === "object" && typeof payload.enabled === "boolean") enabled = payload.enabled;
						return { ok: true, value: { enabled, filled: filledCount } };
				}
				default:
					return { ok: false, error: { code: "model-autodecl/unknown-endpoint", message: "unknown endpoint " + String(endpoint) } };
			}
		} catch (error) {
			return { ok: false, error: { code: "model-autodecl/failed", message: error instanceof Error ? error.message : String(error) } };
		}
	};

	ctx.inject(["connection", "webServer"], (rpcCtx) => {
		rpcCtx.webServer.register({ kind: "prefix", path: "/model-autodecl", handler: makeRpcRouteHandler(rpcCtx, handleRpc) });
	});

	ctx.logger?.info?.("model-autodecl: watching llm-pi-ai declarations");
}
//#endregion

