export interface FilePushRequest {
  readonly filePath: string;
  readonly sessionId?: string;
  readonly filename?: string;
}

export interface FilePushResult {
  readonly success: boolean;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly error?: string;
}
