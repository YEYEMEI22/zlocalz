import { parse as parseICU } from '@messageformat/parser';
import { LocaleFile, ValidationIssue, LocaleReport } from '../types';

export class Validator {
  private sourceFile: LocaleFile;
  private targetFiles: LocaleFile[];

  constructor(sourceFile: LocaleFile, targetFiles: LocaleFile[]) {
    this.sourceFile = sourceFile;
    this.targetFiles = targetFiles;
  }

  validate(): Map<string, LocaleReport> {
    const reports = new Map<string, LocaleReport>();

    for (const targetFile of this.targetFiles) {
      const issues = this.validateTarget(targetFile);
      const stats = this.calculateStats(issues);

      reports.set(targetFile.locale, {
        locale: targetFile.locale,
        format: targetFile.format,
        issues,
        stats
      });
    }

    return reports;
  }

  private validateTarget(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    issues.push(...this.checkMissingKeys(targetFile));
    issues.push(...this.checkExtraKeys(targetFile));
    issues.push(...this.checkDuplicates(targetFile));
    issues.push(...this.checkPlaceholders(targetFile));
    issues.push(...this.checkICUMessages(targetFile));
    issues.push(...this.checkFormatting(targetFile));

    return issues;
  }

  private checkMissingKeys(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const sourceKeys = Object.keys(this.sourceFile.entries);
    const targetKeys = new Set(Object.keys(targetFile.entries));

    for (const key of sourceKeys) {
      if (!targetKeys.has(key)) {
        issues.push({
          type: 'missing',
          locale: targetFile.locale,
          key,
          message: `Key "${key}" is missing`,
          severity: 'error',
          sourceValue: this.sourceFile.entries[key].value
        });
      }
    }

    return issues;
  }

  private checkExtraKeys(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const sourceKeys = new Set(Object.keys(this.sourceFile.entries));
    const targetKeys = Object.keys(targetFile.entries);

    for (const key of targetKeys) {
      if (!sourceKeys.has(key)) {
        issues.push({
          type: 'extra',
          locale: targetFile.locale,
          key,
          message: `Key "${key}" not in source locale`,
          severity: 'warning',
          targetValue: targetFile.entries[key].value
        });
      }
    }

    return issues;
  }

  private checkDuplicates(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const seenValues = new Map<string, string[]>();

    for (const [key, entry] of Object.entries(targetFile.entries)) {
      const value = entry.value.trim();
      if (!seenValues.has(value)) {
        seenValues.set(value, []);
      }
      seenValues.get(value)!.push(key);
    }

    for (const [value, keys] of seenValues.entries()) {
      if (keys.length > 1) {
        for (let i = 1; i < keys.length; i++) {
          issues.push({
            type: 'duplicate',
            locale: targetFile.locale,
            key: keys[i],
            message: `Duplicate value with key "${keys[0]}"`,
            severity: 'warning',
            targetValue: value,
            suggestion: `Remove duplicate or differentiate from "${keys[0]}"`
          });
        }
      }
    }

    return issues;
  }

  private checkPlaceholders(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const key of Object.keys(this.sourceFile.entries)) {
      if (!targetFile.entries[key]) continue;

      const sourcePlaceholders = this.extractPlaceholders(this.sourceFile.entries[key].value);
      const targetPlaceholders = this.extractPlaceholders(targetFile.entries[key].value);

      // const sourcePSet = new Set(sourcePlaceholders);
      const targetPSet = new Set(targetPlaceholders);

      if (sourcePlaceholders.length !== targetPlaceholders.length ||
          !sourcePlaceholders.every(p => targetPSet.has(p))) {
        issues.push({
          type: 'placeholderMismatch',
          locale: targetFile.locale,
          key,
          message: `Placeholder mismatch: expected [${sourcePlaceholders.join(', ')}], found [${targetPlaceholders.join(', ')}]`,
          severity: 'error',
          sourceValue: this.sourceFile.entries[key].value,
          targetValue: targetFile.entries[key].value
        });
      }
    }

    return issues;
  }

  private checkICUMessages(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const key of Object.keys(this.sourceFile.entries)) {
      if (!targetFile.entries[key]) continue;

      const sourceValue = this.sourceFile.entries[key].value;
      const targetValue = targetFile.entries[key].value;

      if (this.isICUMessage(sourceValue)) {
        try {
          const sourceAST = parseICU(sourceValue);
          const targetAST = parseICU(targetValue);

          if (!this.compareICUStructure(sourceAST, targetAST)) {
            issues.push({
              type: 'icuError',
              locale: targetFile.locale,
              key,
              message: 'ICU structure mismatch with source',
              severity: 'error',
              sourceValue,
              targetValue
            });
          }
        } catch (error) {
          issues.push({
            type: 'icuError',
            locale: targetFile.locale,
            key,
            message: `Invalid ICU message: ${error}`,
            severity: 'error',
            targetValue
          });
        }
      }
    }

    return issues;
  }

  private checkFormatting(targetFile: LocaleFile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const [key, entry] of Object.entries(targetFile.entries)) {
      const value = entry.value;

      if (value !== value.trim()) {
        issues.push({
          type: 'formatting',
          locale: targetFile.locale,
          key,
          message: 'Value has leading or trailing whitespace',
          severity: 'warning',
          targetValue: value,
          suggestion: value.trim()
        });
      }

      if (value.includes('  ')) {
        issues.push({
          type: 'formatting',
          locale: targetFile.locale,
          key,
          message: 'Value contains multiple consecutive spaces',
          severity: 'warning',
          targetValue: value,
          suggestion: value.replace(/\s+/g, ' ')
        });
      }
    }

    return issues;
  }

  private isICUMessage(value: string): boolean {
    return value.includes('{') && (
      value.includes(', plural,') ||
      value.includes(', select,') ||
      value.includes(', selectordinal,')
    );
  }

  private compareICUStructure(ast1: any, ast2: any): boolean {
    return JSON.stringify(this.extractICUStructure(ast1)) === 
           JSON.stringify(this.extractICUStructure(ast2));
  }

  private extractICUStructure(ast: any): any {
    if (Array.isArray(ast)) {
      return ast.map(node => this.extractICUStructure(node));
    }
    
    if (ast && typeof ast === 'object') {
      const structure: any = { type: ast.type };
      
      if (ast.argument) structure.argument = ast.argument;
      if (ast.pluralType) structure.pluralType = ast.pluralType;
      if (ast.options) {
        structure.options = Object.keys(ast.options).sort();
      }
      
      return structure;
    }
    
    return null;
  }

  private calculateStats(issues: ValidationIssue[]): LocaleReport['stats'] {
    const stats = {
      totalKeys: Object.keys(this.sourceFile.entries).length,
      missingKeys: 0,
      extraKeys: 0,
      duplicates: 0,
      icuErrors: 0,
      placeholderMismatches: 0,
      formattingWarnings: 0
    };

    for (const issue of issues) {
      switch (issue.type) {
        case 'missing':
          stats.missingKeys++;
          break;
        case 'extra':
          stats.extraKeys++;
          break;
        case 'duplicate':
          stats.duplicates++;
          break;
        case 'icuError':
          stats.icuErrors++;
          break;
        case 'placeholderMismatch':
          stats.placeholderMismatches++;
          break;
        case 'formatting':
          stats.formattingWarnings++;
          break;
      }
    }

    return stats;
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