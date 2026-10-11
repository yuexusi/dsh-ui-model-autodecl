# dsh-ui-model-autodecl

DSH 模型声明自动补全插件：启动时和手动 rescan 时，为 `llm-pi-ai` 用户层里**缺失**的模型能力声明自动填入保守默认值
（输入模态=text、上下文窗口=128k、输出上限=8192），绝不覆盖已有声明；同时注入系统提示告诉模型哪些能力是插件补的默认值、该如何对待。

## 行为

- 只补全用户层自己声明的模型（与 thinking-effort 的档位补齐同一规则）；组合底层提供的模型不动
- 已有字段（包括用户显式声明的空值）永远不被覆盖
- 每次填完通过 `settings.update` 写回（带 revision 冲突保护）
- `/model-autodecl` JSON 通道（cookie 鉴权）：`get`/`rescan`/`set`

## 注入的上下文

补全发生过时，系统提示出现 `## Model capability declarations` 小节：告诉模型被补的路线输入是 text-only、上下文 128k、
输出 8192，图片输入按不可用对待，用户可在模型设置页修正。

## 安装

```sh
pnpm add github:yuexusi/dsh-ui-model-autodecl
```

加进 `dsh.profile.bundles` 后重启 `dsh web`。

## 开发

```sh
node test/host.mjs
```

## 许可

[MIT](LICENSE)
