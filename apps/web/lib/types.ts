export type FileKind = "file" | "directory";

export type FileItem = {
  name: string;
  path: string;
  kind: FileKind;
  size_bytes: number | null;
  modified_at: string;
};

export type DirectoryListing = {
  path: string;
  items: FileItem[];
};

export type SearchResponse = {
  query: string;
  items: FileItem[];
  total: number;
};

export type MutationResponse = {
  path: string;
  message: string;
};

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "unsupported";

export type PreviewInfo = {
  supported: boolean;
  kind: PreviewKind;
  mime_type: string | null;
  size_bytes: number;
  reason: string | null;
};

export type ApiError = {
  error: string;
};
