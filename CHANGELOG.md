

## v1.0.1(2026-8-14)

### Features

feat(tts): 添加 en-GB 英式语音选项

- info.json: en-US 语音菜单更名 en-*语音，追加 5 个英式语音（Ryan/Sonia/Thomas/Libby/Maisie）

- ssml.ts: xml:lang 跟随 voice 名称区域前缀，保证英式语音 SSML 自洽

- README: 更新语音配置说明



## v1.0.0 (2026-05-26)

### Features

- 支持 Edge TTS、Azure 认知服务、Azure 体验服务和 OpenAI 兼容网关四种合成方案。
- 支持简体中文、繁体中文、英语、日语、韩语常用语音。
- 支持情感风格、语速、音调、音量和输出音质配置。
- 支持长文本自动分块、并发合成和音频拼接。
- 内置 429 限流和 5xx 服务端错误的指数退避重试。

