/**
 * @module core/ssml
 * @description SSML（Speech Synthesis Markup Language）生成器。
 *
 * 负责将语音合成参数（语音名称、语速、音调、音量、风格等）统一构建为
 * 符合 Microsoft Azure / Edge TTS 服务要求的 SSML XML 标记。
 * 根据是否指定情感风格（style），自动选择是否包裹 `<mstts:express-as>` 标签。
 */

/**
 * 对字符串进行 XML 转义，替换 XML 特殊字符为对应实体引用。
 *
 * @param value - 待转义的原始字符串
 * @returns 转义后的安全 XML 字符串
 */
export function escapeXml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

import type { SynthesisRequest } from '../types';

/**
 * 从语音名称中提取区域标识（locale）前缀。
 *
 * voice 名格式为 `<locale>-<Name>Neural`（如 `en-GB-RyanNeural`、`zh-CN-XiaoxiaoNeural`），
 * 取前 5 个字符作为 `xml:lang`。方言语音（如 `zh-CN-liaoning-XiaobeiNeural`）同样取 `zh-CN`。
 *
 * @param voice - 语音名称
 * @returns 区域标识；voice 不匹配已知格式时返回 `null`（调用方回退 `options.locale`）
 */
function voiceToLocale(voice: string): string | null {
    const match = voice.match(/^([a-z]{2,3}-[A-Z]{2})/);
    return match ? match[1] : null;
}

/**
 * 根据语音合成参数构建完整的 SSML 字符串。
 *
 * 构建逻辑：
 * - 当 `style` 存在时，生成包含 `<mstts:express-as>` 的 SSML，
 *   同时设置 `styledegree="2.0"` 以增强情感表现力；
 * - 否则生成标准 SSML，仅包含 `<prosody>` 韵律控制标签。
 * - 所有文本和属性值均经过 XML 转义，防止注入问题。
 * - `xml:lang` 跟随语音名称的区域前缀（如用户选择 `en-GB-RyanNeural` 时为 `en-GB`），
 *   与 voice 的 locale 保持一致；voice 无匹配前缀时回退 `options.locale`。
 *
 * @param options - SSML 构建选项
 * @returns 完整的 SSML XML 字符串，可直接发送给 TTS 服务
 *
 * @example
 * ```ts
 * buildSsml({
 *   locale: 'en-US',
 *   voice: 'en-GB-RyanNeural',
 *   text: '你好世界',
 *   rate: '+0%',
 *   pitch: '+0Hz',
 *   volume: '+0%',
 *   style: 'cheerful',
 * });
 * ```
 */
export function buildSsml(options: SynthesisRequest): string {
    const rate = options.rate || '+0%';
    const pitch = options.pitch || '+0Hz';
    const volume = options.volume || '+0%';
    const escapedText = escapeXml(options.text);
    const escapedVoice = escapeXml(options.voice);
    const escapedLocale = escapeXml(voiceToLocale(options.voice) || options.locale);

    if (options.style) {
        return `<speak xmlns="http://www.w3.org/2001/10/synthesis" 
                   xmlns:mstts="http://www.w3.org/2001/mstts" 
                   version="1.0" 
                   xml:lang="${escapedLocale}">
                <voice name="${escapedVoice}">
                    <mstts:express-as style="${options.style}" styledegree="2.0">
                        <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
                            ${escapedText}
                        </prosody>
                    </mstts:express-as>
                </voice>
            </speak>`;
    }

    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" 
                   version="1.0" 
                   xml:lang="${escapedLocale}">
                <voice name="${escapedVoice}">
                    <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
                        ${escapedText}
                    </prosody>
                </voice>
            </speak>`;
}
