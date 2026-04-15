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

export interface UrlPushRequest {
  readonly url: string;
  readonly label?: string;
  readonly sessionId?: string;
}

export interface UrlPushResult {
  readonly success: boolean;
  readonly url: string;
  readonly error?: string;
}
