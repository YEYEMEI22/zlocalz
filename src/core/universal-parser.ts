import * as fs from 'fs/promises';
import * as path from 'path';
import glob from 'fast-glob';
import * as YAML from 'yaml';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { LocaleFile, LocaleEntry, LocaleFileFormat, LocalzConfig } from '../types';

export class UniversalParser {
  private config: LocalzConfig;

  constructor(config: LocalzConfig) {
    this.config = config;
  }

  static detectFormat(filePath: string): LocaleFileFormat {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.arb':
        return 'arb';
      case '.json':
        return 'json';
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.csv':
        return 'csv';
      case '.tsv':
        return 'tsv';
      default:
        return 'json'; // Default fallback
    }
  }

  static getFilePatterns(format: LocaleFileFormat | 'auto'): string[] {
    switch (format) {
      case 'arb':
        return ['**/*.arb'];
      case 'json':
        return ['**/*.json'];
      case 'yaml':
        return ['**/*.yaml', '**/*.yml'];
      case 'csv':
        return ['**/*.csv'];
      case 'tsv':
        return ['**/*.tsv'];
      case 'auto':
      default:
        return ['**/*.arb', '**/*.json', '**/*.yaml', '**/*.yml', '**/*.csv', '**/*.tsv'];
    }
  }

  async discoverFiles(basePath: string): Promise<string[]> {
    const format = this.config.fileFormat || 'auto';
    const patterns = this.config.filePattern 
      ? [this.config.filePattern]
      : UniversalParser.getFilePatterns(format);

    const files = await glob(patterns, {
      cwd: basePath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/build/**', '**/.*/**']
    });

    return files.sort();
  }

  async parseAllLocalesFromFile(filePath: string): Promise<LocaleFile[]> {
    const format = UniversalParser.detectFormat(filePath);
    
    if (format === 'csv' || format === 'tsv') {
      const content = await fs.readFile(filePath, 'utf-8');
      const delimiter = format === 'tsv' ? '\t' : (this.config.csvOptions?.delimiter || ',');
      const records = csvParse(content, { 
        delimiter, 
        columns: true,
        skip_empty_lines: true 
      });
      
      const locales: LocaleFile[] = [];
      
      // Find all locale columns
      const allLocales = new Set<string>();
      if (records.length > 0) {
        const columns = Object.keys(records[0]);
        for (const column of columns) {
          if (column !== (this.config.csvOptions?.keyColumn || 'key') && 
              column !== 'description' && 
              column !== 'context') {
            allLocales.add(column);
          }
        }
      }
      
      // Create a LocaleFile for each locale
      for (const locale of allLocales) {
        if (this.config.sourceLocale === locale || this.config.targetLocales.includes(locale)) {
          const entries = this.parseCsvEntries(records, locale);
          const stats = await fs.stat(filePath);
          
          locales.push({
            locale,
            path: filePath,
            format,
            entries,
            raw: { records, locale },
            lastModified: stats.mtime
          });
        }
      }
      
      return locales;
    } else {
      // For non-CSV files, return single locale
      const localeFile = await this.parseFile(filePath);
      return [localeFile];
    }
  }

  async parseFile(filePath: string, targetLocale?: string): Promise<LocaleFile> {
    const format = UniversalParser.detectFormat(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    const locale = targetLocale || this.extractLocale(filePath, format);

    let raw: Record<string, any>;
    let entries: Record<string, LocaleEntry> = {};

    switch (format) {
      case 'arb':
      case 'json':
        raw = JSON.parse(content);
        entries = this.parseJsonEntries(raw);
        break;
      
      case 'yaml':
        raw = YAML.parse(content) || {};
        entries = this.parseYamlEntries(raw, locale);
        break;
      
      case 'csv':
      case 'tsv':
        const delimiter = format === 'tsv' ? '\t' : (this.config.csvOptions?.delimiter || ',');
        const records = csvParse(content, { 
          delimiter, 
          columns: true,
          skip_empty_lines: true 
        });
        raw = { records, locale };
        entries = this.parseCsvEntries(records, locale);
        break;
      
      default:
        throw new Error(`Unsupported file format: ${format}`);
    }

    const stats = await fs.stat(filePath);
    return {
      locale,
      path: filePath,
      format,
      entries,
      raw,
      lastModified: stats.mtime
    };
  }

  private parseJsonEntries(raw: Record<string, any>): Record<string, LocaleEntry> {
    const entries: Record<string, LocaleEntry> = {};
    const metadataPrefix = '@';

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith(metadataPrefix)) continue;
      if (key.startsWith('@@')) continue; // Skip ARB locale markers
      
      const entry: LocaleEntry = {
        key,
        value: String(value)
      };

      // Check for ARB-style metadata
      const metadataKey = `${metadataPrefix}${key}`;
      if (raw[metadataKey]) {
        const metadata = raw[metadataKey];
        entry.metadata = metadata;
        entry.description = metadata.description;
        entry.placeholders = metadata.placeholders;
      }

      entries[key] = entry;
    }

    return entries;
  }

  private parseYamlEntries(raw: Record<string, any>, _locale: string): Record<string, LocaleEntry> {
    const entries: Record<string, LocaleEntry> = {};

    // Handle nested YAML structures
    const flatten = (obj: any, prefix = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Check if it's a translation entry with metadata
          const valueObj = value as any;
          if (valueObj.value !== undefined) {
            entries[fullKey] = {
              key: fullKey,
              value: String(valueObj.value),
              description: valueObj.description,
              context: valueObj.context,
              tags: valueObj.tags,
              metadata: valueObj
            };
          } else {
            flatten(value, fullKey);
          }
        } else {
          entries[fullKey] = {
            key: fullKey,
            value: String(value)
          };
        }
      }
    };

    flatten(raw);
    return entries;
  }

  private parseCsvEntries(records: any[], locale: string): Record<string, LocaleEntry> {
    const entries: Record<string, LocaleEntry> = {};
    const keyColumn = this.config.csvOptions?.keyColumn || 'key';
    const valueColumns = this.config.csvOptions?.valueColumns || { [locale]: locale };
    const valueColumn = valueColumns[locale] || locale;

    for (const record of records) {
      const key = record[keyColumn];
      const value = record[valueColumn];
      
      if (key && value) {
        entries[key] = {
          key,
          value: String(value),
          description: record.description,
          context: record.context,
          tags: record.tags ? record.tags.split(',').map((t: string) => t.trim()) : undefined,
          metadata: record
        };
      }
    }

    return entries;
  }

  async writeFile(localeFile: LocaleFile): Promise<void> {
    let content: string;

    switch (localeFile.format) {
      case 'arb':
      case 'json':
        content = this.generateJsonContent(localeFile);
        break;
      
      case 'yaml':
        content = this.generateYamlContent(localeFile);
        break;
      
      case 'csv':
      case 'tsv':
        content = this.generateCsvContent(localeFile);
        break;
      
      default:
        throw new Error(`Unsupported file format: ${localeFile.format}`);
    }

    await fs.writeFile(localeFile.path, content, 'utf-8');
  }

  private generateJsonContent(localeFile: LocaleFile): string {
    const output: Record<string, any> = {};
    
    // Preserve special keys like @@locale for ARB files
    if (localeFile.format === 'arb' && localeFile.raw['@@locale']) {
      output['@@locale'] = localeFile.raw['@@locale'];
    }

    const keys = Object.keys(localeFile.entries);
    if (this.config.preferOrder === 'alphabetical') {
      keys.sort();
    }

    for (const key of keys) {
      const entry = localeFile.entries[key];
      output[key] = entry.value;

      // Add metadata for ARB files
      if (localeFile.format === 'arb' && (entry.metadata || entry.description || entry.placeholders)) {
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

  private generateYamlContent(localeFile: LocaleFile): string {
    const output: Record<string, any> = {};

    for (const [key, entry] of Object.entries(localeFile.entries)) {
      const keyParts = key.split('.');
      let current = output;

      for (let i = 0; i < keyParts.length - 1; i++) {
        if (!current[keyParts[i]]) {
          current[keyParts[i]] = {};
        }
        current = current[keyParts[i]];
      }

      const finalKey = keyParts[keyParts.length - 1];
      
      if (entry.description || entry.context || entry.tags || entry.metadata) {
        current[finalKey] = {
          value: entry.value,
          ...(entry.description && { description: entry.description }),
          ...(entry.context && { context: entry.context }),
          ...(entry.tags && { tags: entry.tags })
        };
      } else {
        current[finalKey] = entry.value;
      }
    }

    return YAML.stringify(output, { indent: 2 });
  }

  private generateCsvContent(localeFile: LocaleFile): string {
    const delimiter = localeFile.format === 'tsv' ? '\t' : (this.config.csvOptions?.delimiter || ',');
    const keyColumn = this.config.csvOptions?.keyColumn || 'key';
    const valueColumn = this.config.csvOptions?.valueColumns?.[localeFile.locale] || localeFile.locale;

    const records = Object.values(localeFile.entries).map(entry => ({
      [keyColumn]: entry.key,
      [valueColumn]: entry.value,
      ...(entry.description && { description: entry.description }),
      ...(entry.context && { context: entry.context }),
      ...(entry.tags && { tags: entry.tags.join(', ') })
    }));

    return csvStringify(records, { 
      delimiter, 
      header: true,
      quoted_string: true 
    });
  }

  private extractLocale(filePath: string, _format: LocaleFileFormat): string {
    const basename = path.basename(filePath, path.extname(filePath));
    
    // Different naming conventions
    const patterns = [
      // Flutter ARB: app_en.arb, strings_es.arb
      /^(.+)_([a-z]{2}(?:_[A-Z]{2})?)$/,
      // i18n JSON: en.json, es-ES.json
      /^([a-z]{2}(?:[-_][A-Z]{2})?)$/,
      // Localized folders: en/strings.json, es/app.json
      /^([a-z]{2}(?:[-_][A-Z]{2})?)[\\/](.+)$/
    ];

    for (const pattern of patterns) {
      const match = basename.match(pattern);
      if (match) {
        return match[match.length - 1].replace('-', '_');
      }
    }

    // Check parent directory for locale
    const parentDir = path.basename(path.dirname(filePath));
    if (/^[a-z]{2}(?:[-_][A-Z]{2})?$/.test(parentDir)) {
      return parentDir.replace('-', '_');
    }

    return 'unknown';
  }
}