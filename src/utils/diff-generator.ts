import { createTwoFilesPatch } from 'diff';
import { LocaleFile, Patch } from '../types';

export class DiffGenerator {
  static async generatePatch(
    originalFile: LocaleFile,
    modifiedFile: LocaleFile,
    format: 'unified' | 'git' = 'unified'
  ): Promise<Patch> {
    const originalContent = await this.serializeARB(originalFile);
    const modifiedContent = await this.serializeARB(modifiedFile);

    const patch = createTwoFilesPatch(
      originalFile.path,
      modifiedFile.path,
      originalContent,
      modifiedContent,
      'original',
      'modified',
      { context: 3 }
    );

    return {
      path: modifiedFile.path,
      diff: patch,
      format
    };
  }

  static async generatePatches(
    originalFiles: Map<string, LocaleFile>,
    modifiedFiles: Map<string, LocaleFile>
  ): Promise<Patch[]> {
    const patches: Patch[] = [];

    for (const [locale, modifiedFile] of modifiedFiles) {
      const originalFile = originalFiles.get(locale);
      if (!originalFile) continue;

      const hasChanges = await this.hasChanges(originalFile, modifiedFile);
      if (hasChanges) {
        const patch = await this.generatePatch(originalFile, modifiedFile);
        patches.push(patch);
      }
    }

    return patches;
  }

  private static async serializeARB(file: LocaleFile): Promise<string> {
    const output: Record<string, any> = {};
    
    if (file.raw['@@locale']) {
      output['@@locale'] = file.raw['@@locale'];
    }

    const keys = Object.keys(file.entries).sort();
    for (const key of keys) {
      const entry = file.entries[key];
      output[key] = entry.value;

      if (entry.metadata || entry.description || entry.placeholders) {
        const metadata: any = {};
        if (entry.description) metadata.description = entry.description;
        if (entry.placeholders) metadata.placeholders = entry.placeholders;
        if (entry.metadata) Object.assign(metadata, entry.metadata);
        
        if (Object.keys(metadata).length > 0) {
          output[`@${key}`] = metadata;
        }
      }
    }

    return JSON.stringify(output, null, 2) + '\n';
  }

  private static async hasChanges(
    originalFile: LocaleFile,
    modifiedFile: LocaleFile
  ): Promise<boolean> {
    const original = await this.serializeARB(originalFile);
    const modified = await this.serializeARB(modifiedFile);
    return original !== modified;
  }

  static formatPatchForDisplay(patch: Patch): string {
    const lines = patch.diff.split('\n');
    const formatted: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        formatted.push(`\x1b[36m${line}\x1b[0m`);
      } else if (line.startsWith('@@')) {
        formatted.push(`\x1b[35m${line}\x1b[0m`);
      } else if (line.startsWith('+')) {
        formatted.push(`\x1b[32m${line}\x1b[0m`);
      } else if (line.startsWith('-')) {
        formatted.push(`\x1b[31m${line}\x1b[0m`);
      } else {
        formatted.push(line);
      }
    }

    return formatted.join('\n');
  }
}