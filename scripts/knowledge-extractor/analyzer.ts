import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage } from "./extractor";

export interface KnowledgeEntry {
  title: string;
  symptom: string;
  root_cause: string;
  solution: string;
  prevention: string;
  context: {
    language: string;
    tools: string[];
    files_involved: string[];
  };
  tags: string[];
  confidence: "high" | "medium" | "low";
}

const EXTRACTION_PROMPT = `あなたはシニアソフトウェアエンジニアです。
以下のClaude Codeセッションの会話ログを分析し、
チームが将来参照できるトラブルシューティング・ナレッジベースの
エントリを抽出してください。

## 抽出ルール

1. 会話の中で**問題の発生→調査→解決**の流れがあるものだけを抽出する
2. 単なるコード生成や一般的な質問応答は除外する
3. 1つの会話ログから複数のエントリが抽出される場合がある
4. 情報が不完全な場合は、わかる範囲で埋め、不明な箇所は "不明" とする

## 出力フォーマット (JSON配列)

[
  {
    "title": "問題を端的に表すタイトル（50文字以内）",
    "symptom": "何が起きていたか。エラーメッセージ、観測された挙動など",
    "root_cause": "原因は何だったか",
    "solution": "どう解決したか。具体的なコマンドやコード変更を含む",
    "prevention": "再発を防ぐために何ができるか（わかれば）",
    "context": {
      "language": "関連する言語/フレームワーク",
      "tools": ["使用されたツールやコマンド"],
      "files_involved": ["関連ファイルパス"]
    },
    "tags": ["検索用タグ", "2-5個"],
    "confidence": "high | medium | low"
  }
]

## 会話ログ

`;

const MODEL = "gemini-2.5-flash";
const MAX_CONTENT_LENGTH = 900_000;

function formatConversation(messages: ConversationMessage[]): string {
  return messages.map((m) => `### ${m.role.toUpperCase()}\n${m.content}`).join("\n\n---\n\n");
}

export async function extractKnowledge(messages: ConversationMessage[]): Promise<KnowledgeEntry[]> {
  const ai = new GoogleGenAI({});

  const formatted = formatConversation(messages);
  const truncated =
    formatted.length > MAX_CONTENT_LENGTH
      ? `${formatted.slice(0, MAX_CONTENT_LENGTH)}\n\n[... truncated ...]`
      : formatted;

  const prompt = EXTRACTION_PROMPT + truncated;

  console.error(`Sending ${messages.length} messages (${truncated.length} chars) to ${MODEL}...`);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      httpOptions: { timeout: 120_000 },
    },
  });

  const text = response.text;
  if (!text) {
    console.error("Empty response from Gemini");
    return [];
  }

  try {
    return JSON.parse(text) as KnowledgeEntry[];
  } catch {
    console.error("Failed to parse Gemini response as JSON:", text.slice(0, 500));
    return [];
  }
}
