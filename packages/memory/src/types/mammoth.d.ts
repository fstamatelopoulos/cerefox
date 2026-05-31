// Minimal ambient types for `mammoth` (the package ships no .d.ts).
// We only use the .docx → Markdown path. See `ingestion/file-to-markdown.ts`.
declare module "mammoth" {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }
  export interface MammothInput {
    buffer?: Buffer;
    path?: string;
  }
  export function convertToMarkdown(input: MammothInput): Promise<MammothResult>;
  export function convertToHtml(input: MammothInput): Promise<MammothResult>;
  export function extractRawText(input: MammothInput): Promise<MammothResult>;

  const mammoth: {
    convertToMarkdown: typeof convertToMarkdown;
    convertToHtml: typeof convertToHtml;
    extractRawText: typeof extractRawText;
  };
  export default mammoth;
}
