# dsh-ui-model-autodecl

Auto-declares missing pi-ai model capabilities for DSH: fills conservative defaults (input=text, contextWindow=128k, maxTokens=8192) into the `llm-pi-ai` settings user layer at startup and on manual rescan — never overwriting existing declarations — and injects a prompt section telling the model which of its capabilities are plugin-declared defaults. English | [中文](README.zh.md)

## Behavior

- Only fills models the user layer itself declares (the same rule the thinking-effort plugin applies).
- Existing fields (including explicit empty values) are never overwritten.
- Writes go through `settings.update` with revision conflict protection.
- Authenticated `/model-autodecl` JSON channel: `get` / `rescan` / `set`.

## Install

```sh
pnpm add github:yuexusi/dsh-ui-model-autodecl
```

Add to `dsh.profile.bundles`, restart `dsh web`.

## License

[MIT](LICENSE)
