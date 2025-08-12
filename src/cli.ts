#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { LocalzConfig, LocaleFile } from './types';
import { spawn } from 'child_process';
import { UniversalParser } from './core/universal-parser';
import { Validator } from './core/validator';
import { Fixer } from './core/fixer';
import { Translator } from './core/translator';
import { ReportGenerator } from './core/report-generator';
import { LocalzApp } from './tui/app';
import { ZLocalzUpdater } from './utils/updater';
import { SetupWizard } from './utils/setup-wizard';
import { z } from 'zod';

const ConfigSchema = z.object({
  flutterLocalesPath: z.string(),
  sourceLocale: z.string(),
  targetLocales: z.array(z.string()),
  fileFormat: z.enum(['arb', 'json', 'yaml', 'yml', 'csv', 'tsv', 'auto']).default('auto'),
  filePattern: z.string().optional(),
  doAutoFix: z.boolean().default(false),
  translateMissing: z.boolean().default(false),
  geminiModel: z.string().optional(),
  geminiApiKey: z.string().optional(),
  styleGuidelines: z.string().optional(),
  domainGlossary: z.record(z.string()).optional(),
  doNotTranslate: z.array(z.string()).optional(),
  preferOrder: z.enum(['mirror-source', 'alphabetical']).optional(),
  csvOptions: z.object({
    delimiter: z.string().optional(),
    keyColumn: z.string().optional(),
    valueColumns: z.record(z.string()).optional()
  }).optional(),
  autoUpdate: z.boolean().default(true)
});

const program = new Command();

// Initialize auto-updater - will be reconfigured based on config
let updater = new ZLocalzUpdater(true);

program
  .name('zlocalz')
  .description('ZLocalz - Universal TUI Locale Guardian for Flutter l10n/i18n validation and translation')
  .version('1.0.7')
  .addHelpText('afterAll', `\n${chalk.yellow('⚠️  Beta:')} ZLocalz is currently in beta and may have issues.\n` +
    `If you encounter problems, please open an issue via ${chalk.cyan('zlocalz issue --new')} or at ${chalk.cyan('https://github.com/bllfoad/zlocalz/issues')}\n`)
  .hook('preAction', async (thisCommand) => {
    // Show welcome message for auto-updates
    await updater.showWelcomeMessage();
    
    // Check for updates on every command (don't block execution)
    if (thisCommand.name() !== 'update') {
      updater.checkForUpdates().catch(() => {});
    }
  });

program
  .command('scan')
  .description('Scan and validate ARB files')
  .option('-c, --config <path>', 'Path to config file', './zlocalz.config.json')
  .option('-p, --path <path>', 'Flutter locales path')
  .option('-s, --source <locale>', 'Source locale')
  .option('-t, --targets <locales...>', 'Target locales')
  .option('-f, --format <format>', 'File format (arb, json, yaml, csv, tsv, auto)', 'auto')
  .option('--pattern <pattern>', 'Custom file pattern')
  .option('--auto-fix', 'Auto-fix issues')
  .option('--translate', 'Translate missing keys')
  .option('--no-tui', 'Disable TUI interface')
  .action(async (options) => {
    try {
      const config = await loadConfig(options);
      
      if (!options.tui) {
        await runCLI(config);
      } else {
        await launchTUI(config);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('fix')
  .description('Auto-fix validation issues')
  .option('-c, --config <path>', 'Path to config file', './zlocalz.config.json')
  .action(async (options) => {
    try {
      const config = await loadConfig({ ...options, autoFix: true });
      await runCLI(config);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('translate')
  .description('Translate missing keys')
  .option('-c, --config <path>', 'Path to config file', './zlocalz.config.json')
  .option('-k, --key <key>', 'Gemini API key')
  .action(async (options) => {
    try {
      const config = await loadConfig({ 
        ...options, 
        translateMissing: true,
        geminiApiKey: options.key || process.env.GEMINI_API_KEY
      });
      await runCLI(config);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update ZLocalz to the latest version')
  .option('--check', 'Only check for updates, don\'t install')
  .action(async (options) => {
    try {
      if (options.check) {
        await updater.checkForUpdates();
        await updater.showReleaseNotes();
      } else {
        const success = await updater.performAutoUpdate(false);
        process.exit(success ? 0 : 1);
      }
    } catch (error) {
      console.error(chalk.red('Update failed:'), error);
      process.exit(1);
    }
  });

program
  .command('issue')
  .description('Open GitHub issues page or create a new issue')
  .option('--new', 'Open the new issue form')
  .action((options) => {
    const base = 'https://github.com/bllfoad/zlocalz/issues';
    const url = options.new ? `${base}/new/choose` : base;
    openUrlInBrowser(url);
  });

// Handle no command provided - run setup wizard or scan
if (process.argv.length === 2) {
  checkForConfigAndRun().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  });
} else {
  program.parse();
}

async function checkForConfigAndRun(): Promise<void> {
  // Always check for updates first (silent in background)
  try {
    await updater.checkForUpdates();
    await updater.showWelcomeMessage();
    // Perform auto-update if available and enabled
    if (updater) {
      updater.performAutoUpdate(true).catch(() => {}); // Silent auto-update
    }
  } catch (error) {
    // Ignore update errors, don't block the main functionality
  }

  const configPath = path.resolve('./zlocalz.config.json');
  
  try {
    await fs.access(configPath);
    // Config exists, load it and launch TUI
    const config = await loadConfig({ config: configPath });
    await launchTUI(config);
  } catch (error) {
    // Config doesn't exist, run setup wizard
    await runSetupWizard();
  }
}

async function runSetupWizard(): Promise<void> {
  const wizard = new SetupWizard();
  console.log(chalk.blue('\n🔧 ZLocalz Setup'));
  console.log(chalk.gray('No configuration found. Let\'s set up ZLocalz for your project.'));
  
  try {
    const config = await wizard.run();
    
    // Give user a moment to read the completion message
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Now launch the TUI with the newly created config
    await launchTUI(config);
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      console.log(chalk.yellow('\n👋 Setup cancelled. Run `zlocalz` again to continue setup.'));
      process.exit(0);
    }
    throw error;
  }
}

async function loadConfig(options: any): Promise<LocalzConfig> {
  let config: any = {};

  if (options.config) {
    try {
      const configPath = path.resolve(options.config);
      const configContent = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(configContent);
    } catch (error) {
      if (options.config !== './zlocalz.config.json') {
        throw new Error(`Failed to load config file: ${error}`);
      }
    }
  }

  if (options.path) config.flutterLocalesPath = options.path;
  if (options.source) config.sourceLocale = options.source;
  if (options.targets) config.targetLocales = options.targets;
  if (options.format) config.fileFormat = options.format;
  if (options.pattern) config.filePattern = options.pattern;
  if (options.autoFix !== undefined) config.doAutoFix = options.autoFix;
  if (options.translateMissing !== undefined) config.translateMissing = options.translateMissing;
  if (options.geminiApiKey) config.geminiApiKey = options.geminiApiKey;

  config.geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;

  return ConfigSchema.parse(config);
}

async function launchTUI(config: LocalzConfig): Promise<void> {
  // Reconfigure updater based on user config
  updater = new ZLocalzUpdater(config.autoUpdate !== false);
  
  const spinner = ora('Loading locale files...').start();

  try {
    const { sourceFile, targetFiles } = await loadLocaleFiles(config);
    spinner.succeed('Locale files loaded');

    const app = new LocalzApp(config);
    
    await app.initialize(sourceFile, Array.from(targetFiles.values()));

    const validator = new Validator(sourceFile, Array.from(targetFiles.values()));
    const reports = validator.validate();
    
    const issues = new Map();
    for (const [locale, report] of reports) {
      issues.set(locale, report.issues);
    }
    
    app.updateIssues(issues);

    setupAppHandlers(app, config, sourceFile, targetFiles);

    app.render();
  } catch (error) {
    spinner.fail('Failed to load ARB files');
    throw error;
  }
}

async function runCLI(config: LocalzConfig): Promise<void> {
  // Reconfigure updater based on user config
  updater = new ZLocalzUpdater(config.autoUpdate !== false);
  
  const spinner = ora('Scanning locale files...').start();

  try {
    const { sourceFile, targetFiles } = await loadLocaleFiles(config);
    const formats = [...new Set([sourceFile.format, ...Array.from(targetFiles.values()).map(f => f.format)])];
    spinner.succeed(`Found ${targetFiles.size + 1} files (${formats.join(', ')})`);

    const validator = new Validator(sourceFile, Array.from(targetFiles.values()));
    const reports = validator.validate();

    displayValidationResults(reports);

    const originalFiles = new Map(
      Array.from(targetFiles.entries()).map(([k, v]) => [k, structuredClone(v) as LocaleFile])
    );

    const appliedFixes = new Map();
    const translations: any[] = [];

    if (config.doAutoFix) {
      spinner.start('Applying auto-fixes...');
      const fixer = new Fixer(config, sourceFile);
      
      for (const [locale, file] of targetFiles) {
        const report = reports.get(locale);
        if (report && report.issues.length > 0) {
          const { fixedFile, appliedFixes: fixes } = await fixer.autoFix(file, report.issues);
          targetFiles.set(locale, fixedFile);
          appliedFixes.set(locale, fixes);
        }
      }
      
      spinner.succeed(`Applied ${Array.from(appliedFixes.values()).flat().length} fixes`);
    }

    if (config.translateMissing && config.geminiApiKey) {
      spinner.start('Translating missing keys...');
      const translator = new Translator(config, config.geminiApiKey);
      
      for (const [locale, file] of targetFiles) {
        const report = reports.get(locale);
        if (report) {
          const missingKeys = report.issues
            .filter(i => i.type === 'missing')
            .map(i => i.key);
          
          if (missingKeys.length > 0) {
            const localeTranslations = await translator.translateMissing(
              sourceFile,
              file,
              locale,
              missingKeys
            );
            translations.push(...localeTranslations);
          }
        }
      }
      
      spinner.succeed(`Translated ${translations.length} keys`);
    }

    spinner.start('Generating report...');
    const report = await ReportGenerator.generateReport(
      config,
      sourceFile,
      targetFiles,
      reports,
      appliedFixes,
      translations,
      originalFiles
    );

    await fs.writeFile('zlocalz-report.json', JSON.stringify(report, null, 2));
    spinner.succeed('Report saved to zlocalz-report.json');

    if (config.doAutoFix || translations.length > 0) {
      spinner.start('Writing updated files...');
      const parser = new UniversalParser(config);
      for (const file of targetFiles.values()) {
        await parser.writeFile(file);
      }
      spinner.succeed('Files updated');
    }

  } catch (error) {
    spinner.fail('Operation failed');
    throw error;
  }
}

async function loadLocaleFiles(config: LocalzConfig): Promise<{
  sourceFile: LocaleFile;
  targetFiles: Map<string, LocaleFile>;
}> {
  const parser = new UniversalParser(config);
  const files = await parser.discoverFiles(config.flutterLocalesPath);
  
  if (files.length === 0) {
    const formats = config.fileFormat === 'auto' ? 'supported formats' : config.fileFormat;
    throw new Error(`No ${formats} files found in ${config.flutterLocalesPath}`);
  }

  const allLocaleFiles: LocaleFile[] = [];
  
  // Handle CSV/TSV files that contain multiple locales
  for (const file of files) {
    const format = UniversalParser.detectFormat(file);
    if (format === 'csv' || format === 'tsv') {
      const multiLocaleFiles = await parser.parseAllLocalesFromFile(file);
      allLocaleFiles.push(...multiLocaleFiles);
    } else {
      const singleFile = await parser.parseFile(file);
      allLocaleFiles.push(singleFile);
    }
  }

  const sourceFile = allLocaleFiles.find(f => f.locale === config.sourceLocale);
  
  if (!sourceFile) {
    const availableLocales = allLocaleFiles.map(f => f.locale).join(', ');
    throw new Error(`Source locale '${config.sourceLocale}' not found. Available locales: ${availableLocales}`);
  }

  const targetFiles = new Map<string, LocaleFile>();
  for (const file of allLocaleFiles) {
    if (config.targetLocales.includes(file.locale)) {
      targetFiles.set(file.locale, file);
    }
  }

  return { sourceFile, targetFiles };
}

function displayValidationResults(reports: Map<string, any>): void {
  console.log('\n' + chalk.bold('Validation Results:'));
  
  for (const [locale, report] of reports) {
    const { stats } = report;
    const hasIssues = Object.values(stats).some((v: any) => typeof v === 'number' && v > 0 && v !== stats.totalKeys);
    
    console.log(`\n${chalk.cyan(locale)}:`);
    
    if (!hasIssues) {
      console.log(chalk.green('  ✓ No issues found'));
    } else {
      if (stats.missingKeys > 0) {
        console.log(chalk.red(`  ✗ Missing keys: ${stats.missingKeys}`));
      }
      if (stats.extraKeys > 0) {
        console.log(chalk.yellow(`  ⚠ Extra keys: ${stats.extraKeys}`));
      }
      if (stats.duplicates > 0) {
        console.log(chalk.yellow(`  ⚠ Duplicates: ${stats.duplicates}`));
      }
      if (stats.icuErrors > 0) {
        console.log(chalk.red(`  ✗ ICU errors: ${stats.icuErrors}`));
      }
      if (stats.placeholderMismatches > 0) {
        console.log(chalk.red(`  ✗ Placeholder mismatches: ${stats.placeholderMismatches}`));
      }
      if (stats.formattingWarnings > 0) {
        console.log(chalk.yellow(`  ⚠ Formatting warnings: ${stats.formattingWarnings}`));
      }
    }
  }
}

function setupAppHandlers(
  app: LocalzApp,
  config: LocalzConfig,
  sourceFile: LocaleFile,
  targetFiles: Map<string, LocaleFile>
): void {
  app.on('execute-command', async (command: string) => {
    switch (command) {
      case 'save':
        const parser = new UniversalParser(config);
        for (const file of targetFiles.values()) {
          await parser.writeFile(file);
        }
        break;
      
      case 'validate':
        const validator = new Validator(sourceFile, Array.from(targetFiles.values()));
        const reports = validator.validate();
        const issues = new Map();
        for (const [locale, report] of reports) {
          issues.set(locale, report.issues);
        }
        app.updateIssues(issues);
        break;
    }
  });
}

function openUrlInBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  } else if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
}