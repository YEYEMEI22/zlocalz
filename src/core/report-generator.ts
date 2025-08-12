import { LocalzReport, LocaleReport, LocaleFile, Fix, Translation } from '../types';
import { DiffGenerator } from '../utils/diff-generator';

export class ReportGenerator {
  static async generateReport(
    config: any,
    sourceFile: LocaleFile,
    targetFiles: Map<string, LocaleFile>,
    localeReports: Map<string, LocaleReport>,
    appliedFixes: Map<string, Fix[]>,
    translations: Translation[],
    originalFiles: Map<string, LocaleFile>
  ): Promise<LocalzReport> {
    const patches = await DiffGenerator.generatePatches(
      originalFiles as Map<string, any>,
      targetFiles as Map<string, any>
    );
    
    const summary = this.generateSummary(
      config,
      sourceFile,
      targetFiles,
      localeReports,
      appliedFixes,
      translations
    );

    const perLocale: Record<string, any> = {};
    for (const [locale, report] of localeReports) {
      perLocale[locale] = this.generateLocaleReport(report);
    }

    const proposedFixes: Fix[] = [];
    for (const fixes of appliedFixes.values()) {
      proposedFixes.push(...fixes);
    }

    const finalFiles = await this.generateFinalFiles(targetFiles);

    return {
      summary,
      perLocale,
      proposedFixes,
      translations,
      patches,
      finalFiles
    };
  }

  private static generateSummary(
    config: any,
    sourceFile: LocaleFile,
    targetFiles: Map<string, LocaleFile>,
    localeReports: Map<string, LocaleReport>,
    appliedFixes: Map<string, Fix[]>,
    translations: Translation[]
  ): LocalzReport['summary'] {
    const issues = {
      missing: 0,
      extra: 0,
      duplicate: 0,
      icuError: 0,
      placeholderMismatch: 0,
      formatting: 0
    };

    for (const report of localeReports.values()) {
      issues.missing += report.stats.missingKeys;
      issues.extra += report.stats.extraKeys;
      issues.duplicate += report.stats.duplicates;
      issues.icuError += report.stats.icuErrors;
      issues.placeholderMismatch += report.stats.placeholderMismatches;
      issues.formatting += report.stats.formattingWarnings;
    }

    const notes: string[] = [];
    
    if (config.domainGlossary) {
      notes.push('Glossary applied');
    }
    
    if (config.preferOrder === 'mirror-source') {
      notes.push('Mirror source order');
    } else if (config.preferOrder === 'alphabetical') {
      notes.push('Alphabetical order');
    }

    if (appliedFixes.size > 0) {
      const totalFixes = Array.from(appliedFixes.values())
        .reduce((sum, fixes) => sum + fixes.length, 0);
      notes.push(`${totalFixes} fixes applied`);
    }

    return {
      sourceLocale: sourceFile.locale,
      targetLocales: Array.from(targetFiles.keys()),
      filesScanned: targetFiles.size + 1,
      issues,
      autoFixed: config.doAutoFix && appliedFixes.size > 0,
      translatedWithGemini: config.translateMissing && translations.length > 0,
      notes
    };
  }

  private static generateLocaleReport(report: LocaleReport): any {
    const result: any = {
      missingKeys: [],
      extraKeys: [],
      duplicates: [],
      placeholderMismatches: [],
      icuIssues: [],
      formattingWarnings: []
    };

    for (const issue of report.issues) {
      switch (issue.type) {
        case 'missing':
          result.missingKeys.push(issue.key);
          break;
        case 'extra':
          result.extraKeys.push(issue.key);
          break;
        case 'duplicate':
          result.duplicates.push(issue.key);
          break;
        case 'placeholderMismatch':
          result.placeholderMismatches.push({
            key: issue.key,
            source: issue.sourceValue || '',
            target: issue.targetValue || ''
          });
          break;
        case 'icuError':
          result.icuIssues.push({
            key: issue.key,
            message: issue.message
          });
          break;
        case 'formatting':
          result.formattingWarnings.push(`${issue.key} ${issue.message}`);
          break;
      }
    }

    return result;
  }

  private static async generateFinalFiles(
    targetFiles: Map<string, LocaleFile>
  ): Promise<Array<{ path: string; contents: string }>> {
    const files: Array<{ path: string; contents: string }> = [];

    for (const file of targetFiles.values()) {
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

      files.push({
        path: file.path,
        contents: JSON.stringify(output, null, 2)
      });
    }

    return files;
  }
}