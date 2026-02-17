// File upload validation constants shared between frontend and backend

export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

export const ACCEPTED_FILE_TYPES = ALLOWED_MIME_TYPES.join(",");

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const MAX_FILES_PER_REQUEST = 5;
