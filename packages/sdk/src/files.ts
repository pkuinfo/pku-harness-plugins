/**
 * Documents the user attached in the current chat (PDF, Word, Excel, PowerPoint, audio
 * transcripts, …), as extracted text the host keeps on the device. The user's message carries
 * each one as `<attachment name=… kind=… id=… chars=…>` with only the beginning inline when it
 * is long; these calls let the agent page through the rest or search it. Offsets and lengths
 * count characters of the extracted text. Document text is third-party content.
 */

export interface FileInfo {
  id: string;
  name: string;
  /** 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'audio' | 'text' | … (host-defined). */
  kind: string;
  /** Length of the extracted text. */
  chars: number;
  /** Pages, sheets, slides or seconds, when the kind has them. */
  units?: number;
}

export interface FileReadResult extends FileInfo {
  /** Where this slice starts. */
  offset: number;
  text: string;
  /** Offset to continue from, null at the end. */
  next: number | null;
}

export interface FileSearchResult {
  id: string;
  name: string;
  matches: { offset: number; snippet: string }[];
}

export interface FilesService {
  /** Documents attached in the current chat (most recent first). */
  list(): Promise<FileInfo[]>;
  read(id: string, offset?: number, length?: number): Promise<FileReadResult>;
  search(id: string, query: string, max?: number): Promise<FileSearchResult>;
}
