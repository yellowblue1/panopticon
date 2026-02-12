import { GoogleGenAI } from "@google/genai";
import type { GenerateContentFn } from "../domain/ports";

const MODEL_ID = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Create a GenerateContentFn backed by the @google/genai SDK.
 * Authentication is handled automatically via Application Default Credentials.
 */
export function createGenerateContentFn(project: string, location: string): GenerateContentFn {
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });

  return async (prompt, options) => {
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: prompt,
      config: {
        responseMimeType: options?.responseMimeType,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      },
    });
    return response.text ?? null;
  };
}
