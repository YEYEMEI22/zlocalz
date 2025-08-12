import * as fs from 'fs/promises';
import * as path from 'path';
import glob from 'fast-glob';
import { ARBFile, ARBEntry } from '../types';

export class ARBParser {
  private static readonly ARB_PATTERN = '**/*.arb';
  private static readonly METADATA_PREFIX = '@';

  static async discoverARBFiles(basePath: string): Promise<string[]> {
    const files = await glob(this.ARB_PATTERN, {
      cwd: basePath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/build/**', '**/.*/**']
    });
    return files.sort();
  }

  static async parseARBFile(filePath: string): Promise<ARBFile> {
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = JSON.parse(content);
    const locale = this.extractLocale(filePath);
    const entries: Record<string, ARBEntry> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith(this.METADATA_PREFIX)) continue;
      
      const entry: ARBEntry = {
        key,
        value: String(value)
      };

      const metadataKey = `${this.METADATA_PREFIX}${key}`;
      if (raw[metadataKey]) {
        const metadata = raw[metadataKey];
        entry.metadata = metadata;
        entry.description = metadata.description;
        entry.placeholders = metadata.placeholders;
      }

      entries[key] = entry;
    }

    const stats = await fs.stat(filePath);
    return {
      locale,
      path: filePath,
      format: 'arb' as const,
      entries,
      raw,
      lastModified: stats.mtime
    };
  }

  static extractLocale(filePath: string): string {
    const basename = path.basename(filePath, '.arb');
    const parts = basename.split('_');
    return parts[parts.length - 1] || 'unknown';
  }

  static async writeARBFile(arbFile: ARBFile): Promise<void> {
    const output: Record<string, any> = {};
    
    if (arbFile.raw['@@locale']) {
      output['@@locale'] = arbFile.raw['@@locale'];
    }

    const keys = Object.keys(arbFile.entries);
    for (const key of keys) {
      const entry = arbFile.entries[key];
      output[key] = entry.value;

      if (entry.metadata || entry.description || entry.placeholders) {
        const metadata: any = {};
        if (entry.description) metadata.description = entry.description;
        if (entry.placeholders) metadata.placeholders = entry.placeholders;
        if (entry.metadata) Object.assign(metadata, entry.metadata);
        
        if (Object.keys(metadata).length > 0) {
          output[`${this.METADATA_PREFIX}${key}`] = metadata;
        }
      }
    }

    const content = JSON.stringify(output, null, 2) + '\n';
    await fs.writeFile(arbFile.path, content, 'utf-8');
  }

  static extractPlaceholders(value: string): string[] {
    const placeholderRegex = /\{([^}]+)\}/g;
    const placeholders: string[] = [];
    let match;

    while ((match = placeholderRegex.exec(value)) !== null) {
      placeholders.push(match[1]);
    }

    return placeholders;
  }

  static normalizeICUMessage(message: string): string {
    return message
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}])\s*/g, '$1')
      .trim();
  }
}