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
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";


// === 1. 声音列表定义 (保持不变) ===
const VOICE_MAP: Record<string, string> = {
  "zh-CN-XiaochenMultilingualNeural": "晓辰 (女/多语言)",
  "zh-CN-XiaoshuangMultilingualNeural": "晓双 (女/萝莉/多语言)",
  "zh-CN-XiaoxiaoMultilingualNeural": "晓晓 (女/多语言 - 默认)",
  "zh-CN-XiaoyouMultilingualNeural": "晓悠 (女/萝莉/多语言)",
  "zh-CN-XiaoyuMultilingualNeural": "晓宇 (女/多语言)",
  "zh-CN-YunfanMultilingualNeural": "云帆 (男/多语言)",
  "zh-CN-YunxiaoMultilingualNeural": "云晓 (男/多语言)",
  "zh-CN-YunyiMultilingualNeural": "云逸 (男/多语言)",
  "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural": "晓晓 (女/高清)",
  "zh-CN-Yunxiao:DragonHDFlashLatestNeural": "云晓 (男/高清)",
};

// === 2. 辅助工具函数 (保持不变) ===
function preprocessText(text: string): string {
    if (!text) return "";
    let clean = text;
    clean = clean.replace(/[*_`#>]/g, "");
    clean = clean.replace(/——/g, "，");
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    return clean.trim();
}

function getWordCount(text: string): number {
    if (!text) return 0;
    const cnMatch = text.match(/[\u4e00-\u9fa5]/g);
    const cnCount = cnMatch ? cnMatch.length : 0;
    const textWithoutCn = text.replace(/[\u4e00-\u9fa5]/g, " ");
    const enMatch = textWithoutCn.match(/[a-zA-Z0-9\u00C0-\u00FF]+/g);
    const enCount = enMatch ? enMatch.length : 0;
    return cnCount + enCount;
}

function splitText(text: string, maxWordCount: number = 100): string[] {
    if (getWordCount(text) <= maxWordCount) return [text];
    const rawSentences = text.split(/([。！？；.!?;]+)/);
    const mergedSegments: string[] = [];
    let buffer = "";
    for (let i = 0; i < rawSentences.length; i++) {
        const part = rawSentences[i];
        if (getWordCount(buffer + part) < maxWordCount) {
            buffer += part;
        } else {
            if (buffer.trim()) mergedSegments.push(buffer);
            buffer = part;
        }
    }
    if (buffer.trim()) mergedSegments.push(buffer);
    return mergedSegments.filter(s => s.trim().length > 0);
}

// === 3. Edge TTS Client (保持不变) ===
class EdgeTTSClient {
  // ... (内部代码完全不变) ...
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
    const secretKeyBase64 = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";
    const secretKey = Buffer.from(secretKeyBase64, "base64");
    
    const signData = this.hmacSha256(secretKey, bytesToSign);
    return `MSTranslatorAndroidApp::${signData.toString("base64")}::${formattedDate.toLowerCase()}::${uuidStr}`;
  }

  private async getEndpoint() {
    const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const signature = await this.sign(endpointUrl);
    const headers = {
      "Accept-Language": "zh-Hans", "X-ClientVersion": "4.0.530a 5fe1dc6c", "X-UserId": "0f04d16a175c411e",
      "X-HomeGeographicRegion": "zh-Hans-CN", "X-ClientTraceId": this.clientId, "X-MT-Signature": signature,
      "User-Agent": "okhttp/4.5.0", "Content-Type": "application/json; charset=utf-8"
    };
    const res = await fetch(endpointUrl, { method: "POST", headers });
    return await res.json();
  }

  public async getAudio(text: string, voiceName: string, rate: number, pitch: number): Promise<Buffer> {
    if (!this.expiredAt || Date.now() / 1000 > this.expiredAt - 60) {
      this.endpoint = await this.getEndpoint();
      const jwt = this.endpoint.t.split(".")[1];
      const decodedJwt = JSON.parse(Buffer.from(jwt, 'base64').toString());
      this.expiredAt = decodedJwt.exp;
      this.clientId = uuidv4().replace(/-/g, "");
    }
    const url = `https://${this.endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const headers = {
      "Authorization": this.endpoint.t, "Content-Type": "application/ssml+xml",
      "User-Agent": "okhttp/4.5.0", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"
    };
    const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"><voice name="${voiceName}"><mstts:express-as style="general" styledegree="1.0" role="default"><prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody></mstts:express-as></voice></speak>`;
    
    const response = await fetch(url, { method: "POST", headers: headers as any, body: ssml });
    if (!response.ok) throw new Error(`TTS API Error ${response.status}: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

// === 4. MCP Server 实现 ===
interface SpeechSegmentInput {
  speech_content: string; 
  voice_id?: string;      
  speech_rate?: number;   
  speech_pitch?: number;  
}

interface SegmentResult {
  text: string; 
  audio_list: { text: string; audio_path: string }[]; 
}

class EdgeTTSMcpServer {
  private server: Server;
  private ttsClient: EdgeTTSClient;
  private readonly savePath: string;

  constructor() {
    this.server = new Server(
      { name: "edge-tts-server", version: "4.0.0-env-config" },
      { capabilities: { tools: {} } }
    );
    this.ttsClient = new EdgeTTSClient();
    
    this.savePath = this.initializeSavePath();
    
    this.setupHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  private initializeSavePath(): string {
    // 从环境变量 TTS_SAVE_PATH 读取路径
    const envPath = process.env.TTS_SAVE_PATH;
    
    // 如果环境变量不存在，则使用系统临时目录下的一个子目录作为安全默认值
    const saveDirectory = envPath || path.join(os.tmpdir(), "edge-tts-mcp-output");

    console.error(`[Config] Audio save path configured to: ${saveDirectory}`);
    
    // 检查路径是否为绝对路径，如果不是，则抛出错误，强制要求明确的配置
    if (!path.isAbsolute(saveDirectory)) {
        console.error(`[Config Error] TTS_SAVE_PATH must be an absolute path. Received: "${saveDirectory}"`);
        process.exit(1); // 启动失败
    }

    // 确保目录存在
    try {
        fs.mkdirSync(saveDirectory, { recursive: true });
    } catch (error: any) {
        console.error(`[Config Error] Failed to create save directory at ${saveDirectory}: ${error.message}`);
        process.exit(1); // 启动失败
    }
    
    return saveDirectory;
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "batch_generate_speech",
          description: 
            "Batch generate speech audio from text. Audio files are saved to a pre-configured local directory on the server.\n" +
            "### USAGE GUIDE:\n" +
            "1. **Input**: An object with a `segments` array.\n" +
            "2. **Example JSON**:\n" +
            "   `{ \"segments\": [ { \"speech_content\": \"Hello world\" } ] }`\n" +
            "3. **Note**: The save path is configured via the `TTS_SAVE_PATH` environment variable on the server.",
          inputSchema: {
            type: "object",
            properties: {
              segments: {
                type: "array",
                description: "List of speech segment objects.",
                items: {
                  type: "object",
                  properties: {
                    speech_content: { type: "string", description: "The text to be spoken." },
                    voice_id: { type: "string", description: "Optional Voice ID.", enum: Object.keys(VOICE_MAP) },
                    speech_rate: { type: "number", description: "Optional speech rate percentage." },
                    speech_pitch: { type: "number", description: "Optional speech pitch percentage." }
                  },
                  required: ["speech_content"]
                }
              }
            },
            required: ["segments"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "batch_generate_speech") {
        return this.handleBatchGenerate(request.params.arguments);
      }
      throw new McpError(ErrorCode.MethodNotFound, "Tool not found");
    });
  }

  private async handleBatchGenerate(args: any) {
    if (!args || !Array.isArray(args.segments)) {
      throw new McpError(ErrorCode.InvalidParams, "Invalid input: 'segments' array is required.");
    }
    
    const segments = args.segments as SpeechSegmentInput[];
    const totalCount = segments.reduce((acc, cur) => acc + getWordCount(cur.speech_content || ""), 0);
    if (totalCount > 1000) { 
        throw new McpError(ErrorCode.InvalidParams, `Total content count (${totalCount} words/Hanzi) exceeds limit (1000).`);
    }

    console.error(`[Batch] Processing ${segments.length} segments, total word count: ${totalCount}`);

    const segmentPromises = segments.map(async (segInput, index) => {
      const rawText = segInput.speech_content;
      const voice = segInput.voice_id ?? "zh-CN-XiaoxiaoMultilingualNeural";
      const rate = segInput.speech_rate ?? 25; 
      const pitch = segInput.speech_pitch ?? 0;
      const cleanText = preprocessText(rawText);
      const resultObj: SegmentResult = { text: rawText, audio_list: [] };
      if (!cleanText) return resultObj;
      const subSegments = splitText(cleanText, 100);
      
      for (const subText of subSegments) {
        try {
          const audioBuffer = await this.ttsClient.getAudio(subText, voice, rate, pitch);
          
          const filename = `tts_${index}_${Date.now()}_${uuidv4().substring(0,4)}.mp3`;
          const filePath = path.join(this.savePath, filename);
          fs.writeFileSync(filePath, audioBuffer);
          
          resultObj.audio_list.push({ text: subText, audio_path: filePath });

        } catch (e: any) {
          console.error(`[Error] Failed chunk: ${subText.substring(0, 30)}... Reason: ${e.message}`);
          resultObj.audio_list.push({ text: subText, audio_path: "ERROR_GENERATING_OR_SAVING" });
        }
      }
      return resultObj;
    });

    try {
      const finishedSegments = await Promise.all(segmentPromises);
      return { content: [{ type: "text", text: JSON.stringify(finishedSegments, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Batch process error: ${e.message}` }], isError: true };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Edge TTS MCP Server (Env Config Mode) running on stdio");
  }
}

const server = new EdgeTTSMcpServer();
server.run().catch(console.error);