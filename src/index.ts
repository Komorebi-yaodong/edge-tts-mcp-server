#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";

// === 配置常量 ===
const URUSAI_API_URL = "https://api.urusai.cc/v1/upload";

// === 声音定义 (AI 只需看到 ID，不需要看到复杂的中文描述，这会节省 Token 并减少混淆) ===
const VOICE_MAP: Record<string, string> = {
    // --- 推荐女声 (默认/高清/多语言/特色) ---
    "zh-CN-XiaoxiaoMultilingualNeural": "晓晓 (女/多语言 - 默认)",
    "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural": "晓晓 (女/高清 - 情感更丰富)",
    "zh-CN-XiaoshuangMultilingualNeural": "晓双 (女/萝莉/多语言)",
    "zh-CN-XiaoyouMultilingualNeural": "晓悠 (女/萝莉/多语言)",
    "zh-CN-XiaochenMultilingualNeural": "晓辰 (女/知性/多语言)",
    "zh-CN-XiaoyuMultilingualNeural": "晓宇 (女/多语言)",
    "zh-CN-XiaoyiNeural": "晓伊 (女/甜美)",
    "zh-CN-XiaomengNeural": "晓梦 (女/梦幻)",

    // --- 推荐男声 (默认/高清/多语言/特色) ---
    "zh-CN-YunyiMultilingualNeural": "云逸 (男/多语言 - 默认)",
    "zh-CN-YunxiaoMultilingualNeural": "云晓 (男/多语言)",
    "zh-CN-YunfanMultilingualNeural": "云帆 (男/多语言)",
    "zh-CN-Yunxiao:DragonHDFlashLatestNeural": "云晓 (男/高清 - 情感更丰富)",
    "zh-CN-YunxiNeural": "云希 (男/清朗)",
    "zh-CN-YunfengNeural": "云枫 (男/磁性)",
    "zh-CN-YunjianNeural": "云健 (男/稳重)",
    "zh-CN-YunzeNeural": "云泽 (男/深沉)",
    "zh-CN-YunyeNeural": "云野 (男/野性)",

    // --- 更多女声 ---
    "zh-CN-XiaoxiaoNeural": "晓晓 (女/温柔)",
    "zh-CN-XiaohanNeural": "晓涵 (女/优雅)",
    "zh-CN-XiaomoNeural": "晓墨 (女/文艺)",
    "zh-CN-XiaoqiuNeural": "晓秋 (女/成熟)",
    "zh-CN-XiaoruiNeural": "晓睿 (女/智慧)",
    "zh-CN-XiaoxuanNeural": "晓萱 (女/清新)",
    "zh-CN-XiaoyanNeural": "晓颜 (女/柔美)",
    "zh-CN-XiaozhenNeural": "晓甄 (女/端庄)",

    // --- 更多男声 ---
    "zh-CN-YunyangNeural": "云扬 (男/阳光)",
    "zh-CN-YunhaoNeural": "云皓 (男/豪迈)",
    "zh-CN-YunxiaNeural": "云夏 (男/热情)",
};

// 提取 ID 数组供 Schema 验证使用
const VOICE_IDS = Object.keys(VOICE_MAP);

// 生成帮助文本，让 AI 知道每个 ID 对应的声音特点
const VOICE_DESCRIPTION_TEXT = Object.entries(VOICE_MAP)
  .map(([id, desc]) => `- ${id}: ${desc}`)
  .join("\n");

// 为了代码方便映射，这里保留一个简单的默认值
const DEFAULT_VOICE = "zh-CN-XiaoxiaoMultilingualNeural";

// === 辅助工具函数 ===
async function uploadToUrusai(audioBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData();
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
  formData.append("file", audioBlob, filename);

  const apiToken = process.env.URUSAI_API_TOKEN;
  if (apiToken) formData.append("token", apiToken);
  formData.append("r18", "0");

  try {
    const response = await fetch(URUSAI_API_URL, { method: "POST", body: formData });
    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
    const result = await response.json();
    if (result.status === "success" && result.data?.url_direct) return result.data.url_direct;
    throw new Error(`Upload API error: ${result.message || JSON.stringify(result)}`);
  } catch (error: any) {
    console.error(`[Upload Error] ${error.message}`);
    throw error;
  }
}

function stripId3v2(buffer: Buffer): Buffer {
    if (buffer.length > 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
        const sizeBytes = buffer.slice(6, 10);
        const tagSize = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
        return buffer.slice(10 + tagSize);
    }
    return buffer;
}

function mergeMp3Buffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) return Buffer.alloc(0);
    if (buffers.length === 1) return buffers[0];
    const frames = buffers.slice(1).map(b => stripId3v2(b));
    return Buffer.concat([buffers[0], ...frames]);
}

function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

function preprocessText(text: string, charName?: string): string {
    if (!text) return "";
    
    let cleanText = text;

    // 如果传入了角色名，且文本以 "角色名" + "冒号/空格" 开头，则去除
    if (charName) {
        // 转义正则特殊字符，防止名字里带 . * ? 等导致报错
        const escapedName = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 匹配模式： ^(名字)(任意空白)(中文冒号|英文冒号)(任意空白)
        const namePrefixRegex = new RegExp(`^${escapedName}\\s*[:：]\\s*`, 'i');
        cleanText = cleanText.replace(namePrefixRegex, "");
    } else {
        cleanText = cleanText.replace(/^[\u4e00-\u9fa5a-zA-Z0-9]{2,10}\s*[:：]\s*/, "");
    }

    return cleanText
        .replace(/<[^>]*>/g, "") 
        .replace(/[*_`#>]/g, "")
        .replace(/——/g, "，")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
}

// === Edge TTS Client ===
class EdgeTTSClient {
  private expiredAt: number | null = null;
  private endpoint: any = null;
  private clientId: string = uuidv4().replace(/-/g, "");

  private hmacSha256(key: Buffer, data: string): Buffer {
    const hmac = crypto.createHmac("sha256", key);
    hmac.update(data);
    return hmac.digest();
  }

  private async sign(urlStr: string): Promise<string> {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = uuidv4().replace(/-/g, "");
    const formattedDate = new Date().toUTCString().replace(/GMT/, "").trim() + " GMT";
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate.toLowerCase()}${uuidStr}`.toLowerCase();
    const secretKey = Buffer.from("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==", "base64");
    return `MSTranslatorAndroidApp::${this.hmacSha256(secretKey, bytesToSign).toString("base64")}::${formattedDate.toLowerCase()}::${uuidStr}`;
  }

  private async getEndpoint() {
    const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const signature = await this.sign(endpointUrl);
    const headers = {
      "Accept-Language": "zh-Hans", "X-ClientVersion": "4.0.53a 5fe1dc6c", "X-UserId": "0f04d16a175c411e",
      "X-HomeGeographicRegion": "zh-Hans-CN", "X-ClientTraceId": this.clientId, "X-MT-Signature": signature,
      "User-Agent": "okhttp/4.5.0", "Content-Type": "application/json; charset=utf-8"
    };
    const res = await fetch(endpointUrl, { method: "POST", headers });
    return await res.json();
  }
  
  public async getAudio(text: string, voiceName: string, rateStr: string, pitchStr: string, pauseAfterMs: number = 0): Promise<Buffer> {
    if (!this.expiredAt || Date.now() / 1000 > this.expiredAt - 60) {
      this.endpoint = await this.getEndpoint();
      const jwt = this.endpoint.t.split(".")[1];
      this.expiredAt = JSON.parse(Buffer.from(jwt, 'base64').toString()).exp;
      this.clientId = uuidv4().replace(/-/g, "");
    }
    
    // === 内部转换逻辑：将语义字符串转换为 Edge TTS 具体数值 ===
    let rate = "+0%"; 
    if (rateStr === "normal") rate = "+0%";
    if (rateStr === "slow") rate = "-25%";
    if (rateStr === "fast") rate = "+25%";

    let pitch = "+0Hz";
    if (pitchStr === "low") pitch = "-10Hz";
    if (pitchStr === "high") pitch = "+10Hz";

    const url = `https://${this.endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const headers = {
      "Authorization": this.endpoint.t, 
      "Content-Type": "application/ssml+xml",
      "User-Agent": "okhttp/4.5.0", 
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"
    };

    const safeText = escapeXml(text);
    const breakTag = pauseAfterMs > 0 ? `<break time="${pauseAfterMs}ms"/>` : '';

    const ssml = 
      `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN">` +
        `<voice name="${voiceName}">` +
          `<prosody rate="${rate}" pitch="${pitch}" volume="+0%">` +
            `${safeText}` +
          `</prosody>` +
          `${breakTag}` +
        `</voice>` +
      `</speak>`;
    
    const response = await fetch(url, { method: "POST", headers: headers as any, body: ssml });
    if (!response.ok) throw new Error(`TTS API Error ${response.status}: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

// === MCP 参数接口定义 ===
interface SpeechItem {
    character_name?: string;
    text: string;
    voice: string;
    speed: "normal" | "slow" | "fast";
    pitch: "default" | "low" | "high";
    pause_ms: number;
}

interface GenerateRequest {
    items: SpeechItem[];
    merge_output: boolean; // 提到顶层
}

// === MCP Server 实现 ===
class EdgeTTSMcpServer {
  private server: Server;
  private ttsClient: EdgeTTSClient;

  constructor() {
    this.server = new Server(
      { name: "edge-tts-server", version: "2.0.0" },
      { capabilities: { tools: {} } }
    );
    this.ttsClient = new EdgeTTSClient();
    this.setupHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "text_to_speech",
          description: "Generate speech audio from text. Supports multi-role conversations and audio merging.",
          inputSchema: {
            type: "object",
            properties: {
              merge_output: {
                type: "boolean",
                description: "If true, merges all speech items into a single MP3 file. If false, returns separate files."
              },
              items: {
                type: "array",
                description: "List of speech segments to generate.",
                items: {
                  type: "object",
                  properties: {
                    character_name: {
                        type: "string",
                        description: "The name of the character. Optional."
                    },
                    text: { 
                        type: "string", 
                        description: "The text content to speak." 
                    },
                    voice: { 
                        type: "string", 
                        enum: VOICE_IDS,
                        description: `Voice character ID. Select the most appropriate voice based on the character's persona:\n${VOICE_DESCRIPTION_TEXT}` 
                    },
                    speed: { 
                        type: "string", 
                        enum: ["slow", "normal", "fast"],
                        description: "Speech speed. Default Normal." 
                    },
                    pitch: {
                        type: "string",
                        enum: ["default", "low", "high"],
                        description: "Speech pitch/tone. Default Default."
                    },
                    pause_ms: { 
                        type: "number", 
                        description: "Silence duration (milliseconds) AFTER this segment. Default 0." 
                    }
                  },
                  required: ["text", "voice", "pause_ms"],
                  additionalProperties: false
                }
              }
            },
            required: ["items", "merge_output"],
            additionalProperties: false,
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "text_to_speech") {
        return this.handleGenerate(request.params.arguments as unknown as GenerateRequest);
      }
      throw new McpError(ErrorCode.MethodNotFound, "Tool not found");
    });
  }

  private async handleGenerate(args: GenerateRequest) {
    if (!args.items || args.items.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "Items array cannot be empty");
    }

    console.error(`[TTS] Processing ${args.items.length} items. Merge: ${args.merge_output}`);
    
    // 预处理所有请求
    const tasks = args.items.map(async (item, idx) => {
        const text = preprocessText(item.text, item.character_name);
        if (!text) return null;
      
        try {
            // 使用新版的语义参数 (normal/fast 等)
            const buffer = await this.ttsClient.getAudio(
                text, 
                item.voice || DEFAULT_VOICE, 
                item.speed || "normal", 
                item.pitch || "default", 
                item.pause_ms || 0
            );
            return { buffer, text, idx };
        } catch (e: any) {
            console.error(`Error generating item ${idx}: ${e.message}`);
            return { error: e.message, text, idx };
        }
    });

    const results = (await Promise.all(tasks)).filter(r => r !== null);

    // 模式 1: 合并输出
    if (args.merge_output) {
        const validBuffers = results
            .filter((r): r is { buffer: Buffer, text: string, idx: number } => !('error' in r!))
            .sort((a, b) => a.idx - b.idx)
            .map(r => r.buffer);
        
        if (validBuffers.length === 0) {
            return { content: [{ type: "text", text: "Failed to generate any audio segments." }] };
        }

        const mergedBuffer = mergeMp3Buffers(validBuffers);
        const url = await uploadToUrusai(mergedBuffer, `tts_merged_${Date.now()}.mp3`);
        
        return {
            content: [{ 
                type: "text", 
                text: JSON.stringify({ 
                    status: "success", 
                    mode: "merged", 
                    url: url,
                    transcript: results.map(r => r!.text).join("\n") 
                }, null, 2) 
            }]
        };
    } 
    
    // 模式 2: 分离输出
    else {
        const uploadPromises = results.map(async (res) => {
            if ('error' in res!) {
                return { status: "error", text: res.text, error: res.error };
            }
            const url = await uploadToUrusai(res.buffer, `tts_seg_${res.idx}_${Date.now()}.mp3`);
            return { status: "success", text: res.text, url: url };
        });
        
        const finalLinks = await Promise.all(uploadPromises);
        return {
            content: [{ 
                type: "text", 
                text: JSON.stringify(finalLinks, null, 2) 
            }]
        };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Edge TTS MCP Server (Strict Mode) running on stdio");
  }
}

const server = new EdgeTTSMcpServer();
server.run().catch(console.error);