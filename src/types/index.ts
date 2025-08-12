export type LocaleFileFormat = 'arb' | 'json' | 'yaml' | 'yml' | 'csv' | 'tsv';

export interface LocalzConfig {
  flutterLocalesPath: string;
  sourceLocale: string;
  targetLocales: string[];
  fileFormat?: LocaleFileFormat | 'auto';
  filePattern?: string;
  doAutoFix: boolean;
  translateMissing: boolean;
  geminiModel?: string;
  geminiApiKey?: string;
  styleGuidelines?: string;
  domainGlossary?: Record<string, string>;
  doNotTranslate?: string[];
  preferOrder?: 'mirror-source' | 'alphabetical';
  csvOptions?: {
    delimiter?: string;
    keyColumn?: string;
    valueColumns?: Record<string, string>;
  };
  autoUpdate?: boolean;
}

export interface LocaleEntry {
  key: string;
  value: string;
  metadata?: Record<string, any>;
  description?: string;
  placeholders?: Record<string, { type?: string; example?: string }>;
  context?: string;
  tags?: string[];
}

// Keep ARBEntry for backward compatibility
export interface ARBEntry extends LocaleEntry {}

export interface LocaleFile {
  locale: string;
  path: string;
  format: LocaleFileFormat;
  entries: Record<string, LocaleEntry>;
  raw: Record<string, any>;
  lastModified?: Date;
}

// Keep ARBFile for backward compatibility
export interface ARBFile extends LocaleFile {
  format: 'arb';
  entries: Record<string, ARBEntry>;
}

export type IssueType = 
  | 'missing'
  | 'extra'
  | 'duplicate'
  | 'icuError'
  | 'placeholderMismatch'
  | 'formatting';

export interface ValidationIssue {
  type: IssueType;
  locale: string;
  key: string;
  message: string;
  severity: 'error' | 'warning';
  sourceValue?: string;
  targetValue?: string;
  suggestion?: string;
}

export interface LocaleReport {
  locale: string;
  format: LocaleFileFormat;
  issues: ValidationIssue[];
  stats: {
    totalKeys: number;
    missingKeys: number;
    extraKeys: number;
    duplicates: number;
    icuErrors: number;
    placeholderMismatches: number;
    formattingWarnings: number;
  };
}

export interface Translation {
  locale: string;
  key: string;
  sourceValue: string;
  translatedValue: string;
  placeholdersPreserved: boolean;
  glossaryApplied?: string[];
}

export interface Fix {
  type: 'addMissing' | 'removeExtra' | 'removeDuplicate' | 'fixPlaceholder' | 'fixICU' | 'fixFormatting';
  locale: string;
  key: string;
  oldValue?: string;
  newValue?: string;
  description: string;
}

export interface Patch {
  path: string;
  diff: string;
  format: 'unified' | 'git';
}

export interface LocalzReport {
  summary: {
    sourceLocale: string;
    targetLocales: string[];
    filesScanned: number;
    issues: Record<IssueType, number>;
    autoFixed: boolean;
    translatedWithGemini: boolean;
    notes: string[];
  };
  perLocale: Record<string, LocaleReport>;
  proposedFixes: Fix[];
  translations: Translation[];
  patches: Patch[];
  finalFiles: Array<{
    path: string;
    contents: string;
  }>;
}