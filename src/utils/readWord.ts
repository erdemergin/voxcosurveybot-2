import mammoth from 'mammoth';
import fs from 'fs/promises';

/**
 * Reads a Word document (.docx) and extracts its text content.
 * @param source Path to the file (string) or file content (Buffer).
 * @returns The extracted text content as a string.
 */
export async function readWordDocument(source: string | Buffer): Promise<string> {
  try {
    let result;
    if (typeof source === 'string') {
      // If source is a file path
      result = await mammoth.extractRawText({ path: source });
    } else if (Buffer.isBuffer(source)) {
      // If source is a Buffer
      result = await mammoth.extractRawText({ buffer: source });
    } else {
      throw new Error('Invalid source type for readWordDocument. Expected string (path) or Buffer.');
    }
    return result.value; // The raw text
  } catch (error) {
    console.error('Error reading Word document:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Word document: ${message}`);
  }
} 