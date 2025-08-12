import { GoogleGenerativeAI } from '@google/generative-ai';
import pLimit from 'p-limit';
import { LocalzConfig, Translation, LocaleFile } from '../types';

export class Translator {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private config: LocalzConfig;
  private limit: any;

  constructor(config: LocalzConfig, apiKey: string) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: config.geminiModel || 'gemini-2.5-pro' 
    });
    this.limit = pLimit(3);
  }

  async translateMissing(
    sourceFile: LocaleFile,
    targetFile: LocaleFile,
    targetLocale: string,
    keysToTranslate: string[]
  ): Promise<Translation[]> {
    const translations: Translation[] = [];
    const chunks = this.chunkKeys(keysToTranslate, 10);

    for (const chunk of chunks) {
      const chunkTranslations = await this.limit(() => 
        this.translateChunk(sourceFile, targetFile, targetLocale, chunk)
      );
      translations.push(...chunkTranslations);
    }

    return translations;
  }

  private async translateChunk(
    sourceFile: LocaleFile,
    _targetFile: LocaleFile,
    targetLocale: string,
    keys: string[]
  ): Promise<Translation[]> {
    const translations: Translation[] = [];
    const entries = keys.map(key => ({
      key,
      value: sourceFile.entries[key]?.value || '',
      metadata: sourceFile.entries[key]?.metadata
    }));

    const prompt = this.buildPrompt(sourceFile.locale, targetLocale, entries);

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const parsed = this.parseTranslationResponse(text);
      
      for (const key of keys) {
        const sourceValue = sourceFile.entries[key]?.value || '';
        const translatedValue = parsed[key] || '';
        
        const validation = this.validateTranslation(sourceValue, translatedValue);
        
        translations.push({
          locale: targetLocale,
          key,
          sourceValue,
          translatedValue,
          placeholdersPreserved: validation.placeholdersPreserved,
          glossaryApplied: this.checkGlossaryApplication(translatedValue)
        });
      }
    } catch (error) {
      console.error('Translation error:', error);
      
      for (const key of keys) {
        translations.push({
          locale: targetLocale,
          key,
          sourceValue: sourceFile.entries[key]?.value || '',
          translatedValue: 'TRANSLATION_ERROR',
          placeholdersPreserved: false
        });
      }
    }

    return translations;
  }

  private buildPrompt(
    sourceLocale: string,
    targetLocale: string,
    entries: Array<{ key: string; value: string; metadata?: any }>
  ): string {
    const glossarySection = this.config.domainGlossary
      ? `\nDomain Glossary:\n${JSON.stringify(this.config.domainGlossary, null, 2)}`
      : '';

    const doNotTranslateSection = this.config.doNotTranslate
      ? `\nDo NOT translate these tokens: ${this.config.doNotTranslate.join(', ')}`
      : '';

    const styleSection = this.config.styleGuidelines
      ? `\nStyle Guidelines: ${this.config.styleGuidelines}`
      : '';

    const entriesJson = JSON.stringify(
      entries.reduce((acc, entry) => {
        acc[entry.key] = {
          value: entry.value,
          description: entry.metadata?.description
        };
        return acc;
      }, {} as any),
      null,
      2
    );

    return `You are a professional translator for UI text. Translate the following ARB entries from ${sourceLocale} to ${targetLocale}.

CRITICAL RULES:
1. Preserve ALL placeholders exactly as they appear (e.g., {name}, {count})
2. Maintain ICU message format structure (plural, select, etc.)
3. Only translate the actual text content, not placeholders or ICU syntax
4. Keep translations concise and appropriate for UI elements
5. Return ONLY valid JSON with translated values

${glossarySection}
${doNotTranslateSection}
${styleSection}

Input entries:
${entriesJson}

Return a JSON object with the same keys, containing only the translated values.
Example: {"key1": "translated text", "key2": "another translation"}`;
  }

  private parseTranslationResponse(response: string): Record<string, string> {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          result[key] = value;
        } else if (typeof value === 'object' && value !== null && 'value' in value) {
          result[key] = String((value as any).value);
        }
      }
      
      return result;
    } catch (error) {
      console.error('Failed to parse translation response:', error);
      return {};
    }
  }

  private validateTranslation(
    sourceValue: string,
    translatedValue: string
  ): { placeholdersPreserved: boolean; issues: string[] } {
    const sourcePlaceholders = this.extractPlaceholders(sourceValue);
    const translatedPlaceholders = this.extractPlaceholders(translatedValue);
    
    const sourceSet = new Set(sourcePlaceholders);
    const translatedSet = new Set(translatedPlaceholders);
    
    const placeholdersPreserved = 
      sourcePlaceholders.length === translatedPlaceholders.length &&
      sourcePlaceholders.every(p => translatedSet.has(p));

    const issues: string[] = [];
    
    const missing = sourcePlaceholders.filter(p => !translatedSet.has(p));
    if (missing.length > 0) {
      issues.push(`Missing placeholders: ${missing.join(', ')}`);
    }
    
    const extra = translatedPlaceholders.filter(p => !sourceSet.has(p));
    if (extra.length > 0) {
      issues.push(`Extra placeholders: ${extra.join(', ')}`);
    }

    return { placeholdersPreserved, issues };
  }

  private checkGlossaryApplication(translatedValue: string): string[] | undefined {
    if (!this.config.domainGlossary) return undefined;
    
    const applied: string[] = [];
    for (const [term, translation] of Object.entries(this.config.domainGlossary)) {
      if (translatedValue.includes(translation)) {
        applied.push(term);
      }
    }
    
    return applied.length > 0 ? applied : undefined;
  }

  private chunkKeys(keys: string[], chunkSize: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += chunkSize) {
      chunks.push(keys.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private extractPlaceholders(value: string): string[] {
    const placeholderRegex = /\{([^}]+)\}/g;
    const placeholders: string[] = [];
    let match;

    while ((match = placeholderRegex.exec(value)) !== null) {
      placeholders.push(match[1]);
    }

    return placeholders;
  }
}