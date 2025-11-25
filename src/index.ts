#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Catbox } from "node-catbox";
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { setGlobalDispatcher, ProxyAgent } from "undici";

// === 0. 代理配置 ===
const PROXY_URL = process.env.HTTPS_PROXY || "http://127.0.0.1:10808"; 

try {
  const dispatcher = new ProxyAgent(PROXY_URL);
  setGlobalDispatcher(dispatcher);
} catch (error) {
  console.error(`[System] Failed to set proxy:`, error);
}

// === 1. 声音列表定义 ===
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

// === 2. 辅助工具函数 ===

function preprocessText(text: string): string {
  if (!text) return "";
  let clean = text;
  clean = clean.replace(/[*_`#>]/g, ""); 
  clean = clean.replace(/——/g, "，"); 
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); 
  return clean.trim();
}

/**
 * 核心修改：计算“发音单元”数量
 * 规则：汉字数 + 英文单词数
 */
function getWordCount(text: string): number {
  if (!text) return 0;
  
  // 1. 统计汉字 ([\u4e00-\u9fa5])
  const cnMatch = text.match(/[\u4e00-\u9fa5]/g);
  const cnCount = cnMatch ? cnMatch.length : 0;

  // 2. 统计英文/数字单词 (去除汉字后，按非单词字符分割)
  // 先把汉字替换为空格，避免粘连干扰
  const textWithoutCn = text.replace(/[\u4e00-\u9fa5]/g, " ");
  // 匹配连续的字母或数字作为单词
  const enMatch = textWithoutCn.match(/[a-zA-Z0-9\u00C0-\u00FF]+/g);
  const enCount = enMatch ? enMatch.length : 0;

  return cnCount + enCount;
}

/**
 * 文本切分：基于 Word Count 进行切分
 * 默认阈值：100 (汉字+单词总数)
 */
function splitText(text: string, maxWordCount: number = 100): string[] {
  // 如果总词数小于限制，直接返回
  if (getWordCount(text) <= maxWordCount) return [text];

  // 还是按标点符号粗分
  const rawSentences = text.split(/([。！？；.!?;]+)/);
  const mergedSegments: string[] = [];
  let buffer = "";

  for (let i = 0; i < rawSentences.length; i++) {
      const part = rawSentences[i];
      
      // 核心修改：这里判断 buffer + part 的“词数”是否超标
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
  audio_list: { text: string; audio_url: string }[]; 
}

class EdgeTTSMcpServer {
  private server: Server;
  private ttsClient: EdgeTTSClient;
  private catbox: Catbox;

  constructor() {
    this.server = new Server(
      { name: "edge-tts-server", version: "2.2.0" },
      { capabilities: { tools: {} } }
    );
    this.ttsClient = new EdgeTTSClient();
    this.catbox = new Catbox();
    this.setupHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "batch_generate_speech",
          description: 
            "Batch generate speech audio from a list of text segments.\n" +
            "### USAGE GUIDE:\n" +
            "1. **Structure**: Input MUST be an object with a `segments` array.\n" +
            "2. **Example JSON**:\n" +
            "   `{ \"segments\": [ { \"speech_content\": \"Hello world\" }, { \"speech_content\": \"你好世界\" } ] }`\n" +
            "3. **Limits**: Total content should be under 1000 words/Hanzi characters.\n" +
            "4. **Defaults**: `voice_id` defaults to Xiaoxiao, `speech_rate` defaults to 25 (1.25x speed).\n",
          inputSchema: {
            type: "object",
            properties: {
              segments: {
                type: "array",
                description: "List of speech segment objects.",
                items: {
                  type: "object",
                  properties: {
                    speech_content: { 
                      type: "string", 
                      description: "The actual content/text to be spoken." 
                    },
                    voice_id: { 
                      type: "string", 
                      description: "Optional. Voice ID. Defaults to 'zh-CN-XiaoxiaoMultilingualNeural'.",
                      enum: Object.keys(VOICE_MAP)
                    },
                    speech_rate: { 
                      type: "number", 
                      description: "Optional. Speed percentage. Defaults to 25 (1.25x). Use 0 for normal, 50 for fast." 
                    },
                    speech_pitch: { 
                      type: "number", 
                      description: "Optional. Pitch percentage. Defaults to 0." 
                    }
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
    
    // 核心修改：使用 getWordCount 计算总工作量
    const totalCount = segments.reduce((acc, cur) => acc + getWordCount(cur.speech_content || ""), 0);
    
    if (totalCount > 1000) { 
        throw new McpError(ErrorCode.InvalidParams, `Total content count (${totalCount} words/Hanzi) exceeds limit (1000). Please reduce content.`);
    }

    console.error(`[Batch] Processing ${segments.length} segments, total word count: ${totalCount}`);

    const segmentPromises = segments.map(async (segInput, index) => {
      const rawText = segInput.speech_content;
      
      const voice = segInput.voice_id ?? "zh-CN-XiaoxiaoMultilingualNeural";
      const rate = segInput.speech_rate ?? 25; 
      const pitch = segInput.speech_pitch ?? 0;

      const cleanText = preprocessText(rawText);

      const resultObj: SegmentResult = {
        text: rawText, 
        audio_list: []
      };

      if (!cleanText) return resultObj;

      // 核心修改：按 100 词/汉字切分
      const subSegments = splitText(cleanText, 100);
      
      for (const subText of subSegments) {
        try {
          const audioBuffer = await this.ttsClient.getAudio(subText, voice, rate, pitch);
          
          const stream = Readable.from(audioBuffer);
          const url = await this.catbox.uploadFileStream({
            stream: stream,
            filename: `tts_${index}_${Date.now()}_${uuidv4().substring(0,4)}.mp3`
          });
          
          resultObj.audio_list.push({
            text: subText,
            audio_url: url
          });
        } catch (e: any) {
          console.error(`[Error] Failed chunk: ${e.message}`);
          resultObj.audio_list.push({
            text: subText,
            audio_url: "ERROR_GENERATING"
          });
        }
      }
      return resultObj;
    });

    try {
      const finishedSegments = await Promise.all(segmentPromises);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(finishedSegments, null, 2)
          }
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Batch process error: ${e.message}` }],
        isError: true,
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Edge TTS MCP Server (WordCount Mode) running on stdio");
  }
}

const server = new EdgeTTSMcpServer();
server.run().catch(console.error);