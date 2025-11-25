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

// === 上传模块 (保持不变) ===
const URUSAI_API_URL = "https://api.urusai.cc/v1/upload";

async function uploadToUrusai(audioBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData();
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
  formData.append("file", audioBlob, filename);

  const apiToken = process.env.URUSAI_API_TOKEN;
  if (apiToken) {
    formData.append("token", apiToken);
  }
  formData.append("r18", "0");

  try {
    const response = await fetch(URUSAI_API_URL, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
    }
    const result = await response.json();
    if (result.status === "success" && result.data && result.data.url_direct) {
      return result.data.url_direct;
    } else {
      throw new Error(`API returned an error: ${result.message || JSON.stringify(result)}`);
    }
  } catch (error: any) {
    console.error(`[Upload Error] Failed to upload to URUSAI!: ${error.message}`);
    throw error;
  }
}

// === 音频合并模块 (保持不变) ===
function stripId3v2(buffer: Buffer): Buffer {
    if (buffer.length > 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
        const sizeBytes = buffer.slice(6, 10);
        const tagSize = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
        const headerSize = 10;
        return buffer.slice(headerSize + tagSize);
    }
    return buffer;
}

function mergeMp3Buffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) return Buffer.alloc(0);
    if (buffers.length === 1) return buffers[0];

    const firstBuffer = buffers[0];
    const otherBuffers = buffers.slice(1);
    const audioFrames = otherBuffers.map(buffer => stripId3v2(buffer));
    return Buffer.concat([firstBuffer, ...audioFrames]);
}


const VOICE_MAP: Record<string, string> = {
    // --- 推荐女声 (默认/高清/多语言/特色) ---
    "zh-CN-XiaoxiaoMultilingualNeural": "晓晓 (女/多语言 - 默认)",
    "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural": "晓晓 (女/高清)",
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
    "zh-CN-Yunxiao:DragonHDFlashLatestNeural": "云晓 (男/高清)",
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


// === 辅助工具函数 (保持不变) ===
function preprocessText(text: string): string {
    if (!text) return "";
    let clean = text.replace(/[*_`#>]/g, "").replace(/——/g, "，").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
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

// === Edge TTS Client (保持不变) ===
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
      "Accept-Language": "zh-Hans", "X-ClientVersion": "4.0.53a 5fe1dc6c", "X-UserId": "0f04d16a175c411e",
      "X-HomeGeographicRegion": "zh-Hans-CN", "X-ClientTraceId": this.clientId, "X-MT-Signature": signature,
      "User-Agent": "okhttp/4.5.0", "Content-Type": "application/json; charset=utf-8"
    };
    const res = await fetch(endpointUrl, { method: "POST", headers });
    return await res.json();
  }
  
  public async getAudio(text: string, voiceName: string, rate: number, pitch: number, pauseAfterMs?: number): Promise<Buffer> {
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

    const breakTag = (pauseAfterMs && pauseAfterMs > 0)
      ? `<break time="${pauseAfterMs}ms"/>`
      : '';
      
    const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"><voice name="${voiceName}"><mstts:express-as style="general" styledegree="1.0" role="default"><prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody></mstts:express-as>${breakTag}</voice></speak>`;
    
    const response = await fetch(url, { method: "POST", headers: headers as any, body: ssml });
    if (!response.ok) throw new Error(`TTS API Error ${response.status}: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

// === MCP Server 实现 (保持不变) ===
interface SpeechSegmentInput {
  speech_content: string; 
  voice_id?: string;      
  speech_rate?: number;   
  speech_pitch?: number;  
  merge_audio?: boolean;
  pause_after_ms?: number;
}

interface SegmentResult {
  text: string;
  audio_list: { text: string; audio_path: string }[];
  merged_audio_path?: string;
}

class EdgeTTSMcpServer {
  private server: Server;
  private ttsClient: EdgeTTSClient;

  constructor() {
    this.server = new Server(
      { name: "edge-tts-server", version: "4.3.0-expanded-voices" },
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
          name: "batch_generate_speech",
          description: 
            "Generates speech from text, with optional pauses, and returns public audio URLs. Supports merging multiple segments into one file.\n" +
            "### USAGE GUIDE:\n" +
            "1. **Input**: An object with a `segments` array.\n" +
            "2. **Pauses**: Add `pause_after_ms` (0-5000) to any segment to add silence after it.\n" +
            "3. **Merging**: Set `merge_audio: true` on the *first* segment to merge all audio into one file.\n" +
            "4. **Example (Merged with Pauses)**: `{ \"segments\": [ { \"speech_content\": \"First part.\", \"merge_audio\": true, \"pause_after_ms\": 800 }, { \"speech_content\": \"Second part.\" } ] }`\n" +
            "5. **Note**: For authenticated uploads, set `URUSAI_API_TOKEN` env var.",
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
                    speech_pitch: { type: "number", description: "Optional speech pitch percentage." },
                    merge_audio: { type: "boolean", description: "Set to true on the first segment to merge all audio into one file. Default: false."},
                    pause_after_ms: { type: "number", description: "Milliseconds of silence to add after this segment (0-5000).", minimum: 0, maximum: 5000 }
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
    if (!args || !Array.isArray(args.segments) || args.segments.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "Invalid input: 'segments' array is required and cannot be empty.");
    }
    
    const segments = args.segments as SpeechSegmentInput[];
    const totalCount = segments.reduce((acc, cur) => acc + getWordCount(cur.speech_content || ""), 0);
    if (totalCount > 1000) { 
        throw new McpError(ErrorCode.InvalidParams, `Total content count (${totalCount} words/Hanzi) exceeds limit (1000).`);
    }

    const shouldMerge = segments[0].merge_audio === true;
    console.error(`[Batch] Processing ${segments.length} segments. Merge mode: ${shouldMerge}`);

    if (shouldMerge) {
        return this.handleMergedGeneration(segments);
    } else {
        return this.handleSeparateGeneration(segments);
    }
  }

  private async handleSeparateGeneration(segments: SpeechSegmentInput[]) {
    const segmentPromises = segments.map(async (segInput, index) => {
      const rawText = segInput.speech_content;
      const voice = segInput.voice_id ?? "zh-CN-XiaoxiaoNeural"; // Default to a common voice
      const rate = segInput.speech_rate ?? 25; 
      const pitch = segInput.speech_pitch ?? 0;
      const pause = segInput.pause_after_ms; 
      const cleanText = preprocessText(rawText);
      const resultObj: Omit<SegmentResult, 'merged_audio_path'> = { text: rawText, audio_list: [] };
      if (!cleanText) return resultObj;
      const subSegments = splitText(cleanText, 100);
      
      for (const subText of subSegments) {
        try {
          const audioBuffer = await this.ttsClient.getAudio(subText, voice, rate, pitch, pause);
          const filename = `tts_separate_${index}_${Date.now()}.mp3`;
          const audioUrl = await uploadToUrusai(audioBuffer, filename);
          resultObj.audio_list.push({ text: subText, audio_path: audioUrl });
        } catch (e: any) {
          resultObj.audio_list.push({ text: subText, audio_path: "ERROR_GENERATING_OR_UPLOADING" });
        }
      }
      return resultObj;
    });
    const finishedSegments = await Promise.all(segmentPromises);
    return { content: [{ type: "text", text: JSON.stringify(finishedSegments, null, 2) }] };
  }
  
  private async handleMergedGeneration(segments: SpeechSegmentInput[]) {
      const allSubSegments: { text: string, voice: string, rate: number, pitch: number, pause: number | undefined }[] = [];
      const originalTexts = segments.map(s => s.speech_content);

      for (const segInput of segments) {
          const cleanText = preprocessText(segInput.speech_content);
          if (cleanText) {
              const subSegs = splitText(cleanText, 100);
              subSegs.forEach((subText, index) => {
                  const isLastSubSegment = index === subSegs.length - 1;
                  allSubSegments.push({
                      text: subText,
                      voice: segInput.voice_id ?? "zh-CN-XiaoxiaoNeural",
                      rate: segInput.speech_rate ?? 25,
                      pitch: segInput.speech_pitch ?? 0,
                      pause: isLastSubSegment ? segInput.pause_after_ms : undefined,
                  });
              });
          }
      }

      if (allSubSegments.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ text: originalTexts.join('\n'), merged_audio_path: 'NO_CONTENT_TO_GENERATE' }, null, 2) }] };
      }

      try {
        const audioBufferPromises = allSubSegments.map(sub => 
            this.ttsClient.getAudio(sub.text, sub.voice, sub.rate, sub.pitch, sub.pause)
        );
        const audioBuffers = await Promise.all(audioBufferPromises);

        const mergedBuffer = mergeMp3Buffers(audioBuffers);
        
        const filename = `tts_merged_${Date.now()}.mp3`;
        const mergedUrl = await uploadToUrusai(mergedBuffer, filename);

        const finalResult: SegmentResult = {
            text: originalTexts.join('\n'),
            audio_list: [],
            merged_audio_path: mergedUrl
        };
        
        return { content: [{ type: "text", text: JSON.stringify(finalResult, null, 2) }] };
      } catch (e: any) {
          console.error(`[Merge Error] Failed during merged generation: ${e.message}`);
          return { content: [{ type: "text", text: `Batch merge process error: ${e.message}` }], isError: true };
      }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Edge TTS MCP Server (with Expanded Voices) running on stdio");
  }
}

const server = new EdgeTTSMcpServer();
server.run().catch(console.error);