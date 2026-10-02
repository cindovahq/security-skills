import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

@Injectable()
export class PdfService {
  async extractText(path: string): Promise<string> {
    const { stdout } = await run('/usr/bin/pdftotext', ['-layout', path, '-'], {
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout;
  }
}
