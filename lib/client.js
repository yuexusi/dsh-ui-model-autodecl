window.__ModuleLoader__.load({
	id: "dsh-ui-model-autodecl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		//#region locales
		const NS = "model-autodecl";
		const zh = { "notice.title": "模型声明自动补全" };
		const en = { "notice.title": "Model declaration auto-fill" };
		//#endregion

		//#region registration
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "model-autodecl: dictionaries");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
