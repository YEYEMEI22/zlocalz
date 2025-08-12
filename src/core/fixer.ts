import { LocaleFile, ValidationIssue, Fix, LocalzConfig } from '../types';
import * as lodash from 'lodash';

export class Fixer {
  private config: LocalzConfig;
  private sourceFile: LocaleFile;

  constructor(config: LocalzConfig, sourceFile: LocaleFile) {
    this.config = config;
    this.sourceFile = sourceFile;
  }

  async autoFix(targetFile: LocaleFile, issues: ValidationIssue[]): Promise<{ 
    fixedFile: LocaleFile; 
    appliedFixes: Fix[] 
  }> {
    const fixedFile = lodash.cloneDeep(targetFile);
    const appliedFixes: Fix[] = [];

    for (const issue of issues) {
      const fix = this.generateFix(issue, fixedFile);
      if (fix && this.config.doAutoFix) {
        this.applyFix(fix, fixedFile);
        appliedFixes.push(fix);
      }
    }

    if (this.config.preferOrder === 'mirror-source') {
      this.reorderToMatchSource(fixedFile);
    } else if (this.config.preferOrder === 'alphabetical') {
      this.reorderAlphabetically(fixedFile);
    }

    return { fixedFile, appliedFixes };
  }

  private generateFix(issue: ValidationIssue, targetFile: LocaleFile): Fix | null {
    switch (issue.type) {
      case 'missing':
        return this.generateMissingKeyFix(issue);
      
      case 'extra':
        return this.generateExtraKeyFix(issue);
      
      case 'duplicate':
        return this.generateDuplicateFix(issue, targetFile);
      
      case 'placeholderMismatch':
        return this.generatePlaceholderFix(issue);
      
      case 'formatting':
        return this.generateFormattingFix(issue);
      
      case 'icuError':
        return this.generateICUFix(issue);
      
      default:
        return null;
    }
  }

  private generateMissingKeyFix(issue: ValidationIssue): Fix {
    const sourceEntry = this.sourceFile.entries[issue.key];
    const placeholders = this.extractPlaceholders(sourceEntry.value);
    
    let newValue = 'TODO';
    if (placeholders.length > 0) {
      newValue = sourceEntry.value.replace(/[^{}]+/g, 'TODO');
    }

    return {
      type: 'addMissing',
      locale: issue.locale,
      key: issue.key,
      newValue,
      description: `Add missing key "${issue.key}" with placeholder structure from source`
    };
  }

  private generateExtraKeyFix(issue: ValidationIssue): Fix {
    return {
      type: 'removeExtra',
      locale: issue.locale,
      key: issue.key,
      oldValue: issue.targetValue,
      description: `Remove extra key "${issue.key}" not present in source`
    };
  }

  private generateDuplicateFix(issue: ValidationIssue, targetFile: LocaleFile): Fix {
    return {
      type: 'removeDuplicate',
      locale: issue.locale,
      key: issue.key,
      oldValue: targetFile.entries[issue.key]?.value,
      description: `Remove duplicate key "${issue.key}"`
    };
  }

  private generatePlaceholderFix(issue: ValidationIssue): Fix {
    if (!issue.sourceValue || !issue.targetValue) return {
      type: 'fixPlaceholder',
      locale: issue.locale,
      key: issue.key,
      description: 'Cannot fix placeholder without source/target values'
    };

    const sourcePlaceholders = this.extractPlaceholders(issue.sourceValue);
    let fixedValue = issue.targetValue;

    const targetPlaceholders = this.extractPlaceholders(issue.targetValue);
    const placeholderMap = new Map<string, string>();

    for (let i = 0; i < Math.min(sourcePlaceholders.length, targetPlaceholders.length); i++) {
      if (sourcePlaceholders[i] !== targetPlaceholders[i]) {
        placeholderMap.set(targetPlaceholders[i], sourcePlaceholders[i]);
      }
    }

    for (const [oldPh, newPh] of placeholderMap) {
      fixedValue = fixedValue.replace(new RegExp(`\\{${oldPh}\\}`, 'g'), `{${newPh}}`);
    }

    return {
      type: 'fixPlaceholder',
      locale: issue.locale,
      key: issue.key,
      oldValue: issue.targetValue,
      newValue: fixedValue,
      description: `Fix placeholder names to match source`
    };
  }

  private generateFormattingFix(issue: ValidationIssue): Fix {
    return {
      type: 'fixFormatting',
      locale: issue.locale,
      key: issue.key,
      oldValue: issue.targetValue,
      newValue: issue.suggestion || issue.targetValue?.trim().replace(/\s+/g, ' '),
      description: `Fix formatting issues in "${issue.key}"`
    };
  }

  private generateICUFix(issue: ValidationIssue): Fix {
    if (!issue.sourceValue) return {
      type: 'fixICU',
      locale: issue.locale,
      key: issue.key,
      description: 'Cannot fix ICU without source value'
    };

    const icuPattern = /(\{[^,]+,\s*(plural|select|selectordinal),)([^}]+)\}/g;
    const sourceMatches = [...issue.sourceValue.matchAll(icuPattern)];
    
    let fixedValue = issue.targetValue || '';
    for (const match of sourceMatches) {
      const [fullMatch, _prefix, _type, _options] = match;
      const structureOnly = fullMatch.replace(/[^{}=\s]+(?=[^{}]*[{}])/g, 'TODO');
      fixedValue = structureOnly;
    }

    return {
      type: 'fixICU',
      locale: issue.locale,
      key: issue.key,
      oldValue: issue.targetValue,
      newValue: fixedValue,
      description: `Fix ICU structure to match source`
    };
  }

  private applyFix(fix: Fix, targetFile: LocaleFile): void {
    switch (fix.type) {
      case 'addMissing':
        const sourceEntry = this.sourceFile.entries[fix.key];
        targetFile.entries[fix.key] = {
          key: fix.key,
          value: fix.newValue || 'TODO',
          metadata: sourceEntry.metadata,
          description: sourceEntry.description,
          placeholders: sourceEntry.placeholders
        };
        break;

      case 'removeExtra':
      case 'removeDuplicate':
        delete targetFile.entries[fix.key];
        delete targetFile.raw[fix.key];
        delete targetFile.raw[`@${fix.key}`];
        break;

      case 'fixPlaceholder':
      case 'fixFormatting':
      case 'fixICU':
        if (fix.newValue && targetFile.entries[fix.key]) {
          targetFile.entries[fix.key].value = fix.newValue;
        }
        break;
    }
  }

  private reorderToMatchSource(targetFile: LocaleFile): void {
    const sourceKeys = Object.keys(this.sourceFile.entries);
    const reordered: Record<string, any> = {};

    for (const key of sourceKeys) {
      if (targetFile.entries[key]) {
        reordered[key] = targetFile.entries[key];
      }
    }

    const targetOnlyKeys = Object.keys(targetFile.entries)
      .filter(k => !sourceKeys.includes(k));
    
    for (const key of targetOnlyKeys) {
      reordered[key] = targetFile.entries[key];
    }

    targetFile.entries = reordered;
  }

  private reorderAlphabetically(targetFile: LocaleFile): void {
    const sortedKeys = Object.keys(targetFile.entries).sort();
    const reordered: Record<string, any> = {};

    for (const key of sortedKeys) {
      reordered[key] = targetFile.entries[key];
    }

    targetFile.entries = reordered;
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