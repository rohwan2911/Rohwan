/// <reference types="vite/client" />

declare module 'pizzip' {
  class PizZip {
    constructor(data?: ArrayBuffer | Uint8Array | string);
    generate(options?: { type?: string; mimeType?: string }): any;
  }
  export default PizZip;
}

declare module 'mammoth' {
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: Record<string, unknown>
  ): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
  const mammoth: {
    convertToHtml: typeof convertToHtml;
  };
  export default mammoth;
}
