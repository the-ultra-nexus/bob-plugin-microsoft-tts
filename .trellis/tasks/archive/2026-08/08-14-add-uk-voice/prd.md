# 添加 en-GB 英式语音选项

## Goal

让用户能在 Bob 配置面板的英语语音菜单中直接选择英式英语发音人（如 `en-GB-RyanNeural`），
朗读英文文本时使用英式口音。改动最小化：不新增配置选项、不改动 Provider 路由逻辑。

## Background（已确认事实）

- Bob 语言代码表英语只有 `en`，无 `en-US`/`en-GB` 变体；Bob 朗读英文时 `query.lang` 恒为 `'en'`，插件 `resolveLocale('en')` 固定映射到 `en-US`（`src/config.ts` 的 `supportedLanguages`）。
- 现有语音读取逻辑：`src/service/synthesis-request.ts` 的 `createSynthesisRequest` 中
  `voice: readOption(options, `${locale}-speaker`) || defaultVoices[locale]` —— 用户选择的 voice 字符串原样透传，无校验/过滤。
- voice 全链路透传已验证：`info.json` menuValue → `$option['en-US-speaker']` → `SynthesisRequest.voice` → `buildSsml` 的 `<voice name="${escapedVoice}">`（`src/core/ssml.ts`）→ Edge/Azure Provider；openai-gateway 走 `payload.voice` 直接透传。
- Edge TTS / Azure 的 en-GB 语音（真实返回数据，多数据源一致）：
  `en-GB-RyanNeural`（男）、`en-GB-SoniaNeural`（女）、`en-GB-ThomasNeural`（男）、`en-GB-LibbyNeural`（女）、`en-GB-MaisieNeural`（女）。
- 技术隐患：`buildSsml` 目前用 `options.locale`（en-US）作 `xml:lang`，与 en-GB voice 不匹配；Edge 服务端以 voice name 为主大概率可工作，但 Azure REST 行为不保证，需让 `xml:lang` 跟随 voice。

## Requirements

- R1：`info.json` 中 `en-US-speaker` 选项的 `title` 由 `"en-US语音"` 改为 `"en-*语音"`。
- R2：`info.json` 中 `en-US-speaker` 的 `menuValues` 末尾追加 5 个 en-GB 语音
  （Ryan / Sonia / Thomas / Libby / Maisie，格式与现有美式语音一致：`"title": "Ryan - en-GB-RyanNeural - Male"`）。
- R3：`src/core/ssml.ts` 的 `buildSsml` 中 `xml:lang` 改为从 `options.voice` 名前缀推导
  （如 `en-GB-RyanNeural` → `en-GB`；`zh-CN-XiaoxiaoNeural` → `zh-CN`），voice 无匹配前缀时回退 `options.locale`。
- R4：`README.md` 语音说明微调（提及英式语音可用）。
- R5：默认英语语音保持不变（`en-US-JennyNeural`），`defaultVoices` / `types.ts` / `synthesis-request.ts` / providers 均不改动。

## Acceptance Criteria

- AC1：构建后安装插件，Bob 面板中英语语音菜单标题显示为 `en-*语音`，菜单包含全部原 25 个美式语音 + 5 个英式语音，默认选中 Jenny。
- AC2：在菜单选择 `en-GB-RyanNeural` 后朗读英文，Edge TTS 合成的 SSML 为 `xml:lang="en-GB"` + `<voice name="en-GB-RyanNeural">`（可通过代码审查或日志确认）。
- AC3：选择任一 en-GB 语音时，4 个 Provider（edge-tts / azure-cognitive / azure-trial / openai-gateway）均正常传递 voice；azure 类请求 SSML 自洽。
- AC4：未选择英式语音（默认 Jenny）时，SSML 行为与改动前完全一致（`xml:lang="en-US"`）。
- AC5：`pnpm typecheck` 通过；`pnpm build` 产出 `.bobplugin` 包成功。
- AC6：`.trellis/spec/` 中涉及的规范无需更新（本次不改变架构约定），若 R3 改变了 `buildSsml` 契约则需在 `core/index.md` 补充说明。

## Out of Scope

- 不新增独立的 `en-GB-speaker` 配置选项（用户明确否决）。
- 不加入 en-AU / en-CA / en-IN 等其他英语区域语音。
- 不修改 `types.ts` 的 `Locale` 类型、不修改 `supportedLanguages` 语言映射。
- 不实现按文本自动区分美式/英式口音的机制（Bob 架构下不可行）。
- 不改动 `vendor/bob-shim.js`。

## Open Questions

无（已全部收敛）。
