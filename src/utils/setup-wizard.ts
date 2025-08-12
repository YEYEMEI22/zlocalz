import inquirer from 'inquirer';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { LocalzConfig, LocaleFileFormat } from '../types';
// import { UniversalParser } from '../core/universal-parser'; // TODO: use for file discovery

export class SetupWizard {
  private cwd: string;

  constructor() {
    this.cwd = process.cwd();
  }

  public async run(): Promise<LocalzConfig> {
    console.log(chalk.blue('🚀 Welcome to ZLocalz Setup Wizard!'));
    console.log(chalk.gray('Let\'s configure ZLocalz for your project.\n'));

    // Step 1: Detect existing files and suggest configuration
    const detectedFiles = await this.detectExistingFiles();
    
    // Step 2: Basic configuration
    const config = await this.collectBasicConfig(detectedFiles);
    
    // Step 3: Advanced options
    const advancedConfig = await this.collectAdvancedConfig(config);
    
    // Step 4: Translation setup (optional)
    const translationConfig = await this.collectTranslationConfig();
    
    // Step 5: Merge all configurations
    const finalConfig = {
      ...config,
      ...advancedConfig,
      ...translationConfig
    } as LocalzConfig;

    // Step 6: Create configuration file
    await this.createConfigFile(finalConfig);
    
    // Step 7: Create .env file if needed
    if (translationConfig.geminiApiKey) {
      await this.createEnvFile(translationConfig.geminiApiKey);
    }

    // Step 8: Show summary and next steps
    this.showSetupComplete(finalConfig);

    return finalConfig;
  }

  private async detectExistingFiles(): Promise<{
    formats: LocaleFileFormat[];
    paths: string[];
    suggestedPath?: string;
    suggestedFormat?: LocaleFileFormat;
    detectedLocales?: string[];
    suggestedSourceLocale?: string;
    suggestedTargetLocales?: string[];
  }> {
    const commonPaths = [
      'lib/l10n',
      'assets/l10n', 
      'assets/locales',
      'locales',
      'i18n',
      'translations'
    ];

    const detectedFiles: string[] = [];
    const formats = new Set<LocaleFileFormat>();
    const detectedLocales = new Set<string>();
    let suggestedPath: string | undefined;
    let suggestedFormat: LocaleFileFormat | undefined;

    for (const searchPath of commonPaths) {
      const fullPath = path.join(this.cwd, searchPath);
      try {
        await fs.access(fullPath);
        
        // Check for different file formats
        const arbFiles = await this.findFiles(fullPath, '**/*.arb');
        const jsonFiles = await this.findFiles(fullPath, '**/*.json');
        const yamlFiles = await this.findFiles(fullPath, '**/*.{yml,yaml}');
        const csvFiles = await this.findFiles(fullPath, '**/*.{csv,tsv}');

        if (arbFiles.length > 0) {
          formats.add('arb');
          detectedFiles.push(...arbFiles);
          // Extract locales from ARB filenames (e.g., app_en.arb, app_es.arb)
          for (const file of arbFiles) {
            const locale = this.extractLocaleFromFilename(file, 'arb');
            if (locale) detectedLocales.add(locale);
          }
          if (!suggestedPath) {
            suggestedPath = searchPath;
            suggestedFormat = 'arb';
          }
        }
        if (jsonFiles.length > 0) {
          formats.add('json');
          detectedFiles.push(...jsonFiles);
          // Extract locales from JSON filenames (e.g., en.json, es.json)
          for (const file of jsonFiles) {
            const locale = this.extractLocaleFromFilename(file, 'json');
            if (locale) detectedLocales.add(locale);
          }
          if (!suggestedPath) {
            suggestedPath = searchPath;
            suggestedFormat = 'json';
          }
        }
        if (yamlFiles.length > 0) {
          formats.add('yaml');
          detectedFiles.push(...yamlFiles);
          // Extract locales from YAML filenames (e.g., en.yml, es.yaml)
          for (const file of yamlFiles) {
            const locale = this.extractLocaleFromFilename(file, 'yaml');
            if (locale) detectedLocales.add(locale);
          }
          if (!suggestedPath) {
            suggestedPath = searchPath;
            suggestedFormat = 'yaml';
          }
        }
        if (csvFiles.length > 0) {
          formats.add('csv');
          detectedFiles.push(...csvFiles);
          // For CSV files, we'll need to read the header row to detect locales
          // For now, we'll skip auto-detection for CSV files as they require more complex parsing
          if (!suggestedPath) {
            suggestedPath = searchPath;
            suggestedFormat = 'csv';
          }
        }
      } catch (error) {
        // Path doesn't exist, continue
      }
    }

    // Generate locale suggestions
    const localesArray = Array.from(detectedLocales).sort();
    const suggestedSourceLocale = this.determineMostLikelySource(localesArray);
    const suggestedTargetLocales = localesArray.filter(l => l !== suggestedSourceLocale);

    return {
      formats: Array.from(formats),
      paths: [...new Set(detectedFiles.map(f => path.dirname(path.relative(this.cwd, f))))],
      suggestedPath: suggestedPath || 'lib/l10n',
      suggestedFormat: suggestedFormat || 'arb',
      detectedLocales: localesArray,
      suggestedSourceLocale: suggestedSourceLocale || 'en',
      suggestedTargetLocales: suggestedTargetLocales
    };
  }

  private async findFiles(basePath: string, pattern: string): Promise<string[]> {
    try {
      const glob = (await import('fast-glob')).default;
      return await glob(pattern, {
        cwd: basePath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/build/**']
      });
    } catch (error) {
      return [];
    }
  }

  private extractLocaleFromFilename(filePath: string, format: LocaleFileFormat): string | null {
    const filename = path.basename(filePath);
    
    switch (format) {
      case 'arb':
        // Extract from patterns like: app_en.arb, intl_es.arb, translations_en_US.arb
        const arbMatch = filename.match(/[_-]([a-z]{2,3}([_-][A-Z]{2})?)\.arb$/i);
        return arbMatch ? arbMatch[1].toLowerCase().replace('-', '_') : null;
      
      case 'json':
        // Extract from patterns like: en.json, es.json, en_US.json
        const jsonMatch = filename.match(/^([a-z]{2,3}([_-][A-Z]{2})?)\.json$/i);
        return jsonMatch ? jsonMatch[1].toLowerCase().replace('-', '_') : null;
      
      case 'yaml':
        // Extract from patterns like: en.yml, es.yaml, en_US.yaml
        const yamlMatch = filename.match(/^([a-z]{2,3}([_-][A-Z]{2})?)\.(yml|yaml)$/i);
        return yamlMatch ? yamlMatch[1].toLowerCase().replace('-', '_') : null;
      
      default:
        return null;
    }
  }

  private determineMostLikelySource(locales: string[]): string | null {
    // Priority order for determining source locale
    const commonSourceLocales = ['en', 'en_US', 'en_GB'];
    
    for (const sourceCandidate of commonSourceLocales) {
      if (locales.includes(sourceCandidate)) {
        return sourceCandidate;
      }
    }
    
    // If no common source locale found, return the first one alphabetically
    return locales.length > 0 ? locales[0] : null;
  }

  private async collectBasicConfig(detectedFiles: any): Promise<Partial<LocalzConfig>> {
    if (detectedFiles.formats.length > 0) {
      console.log(chalk.green(`✅ Found existing localization files!`));
      console.log(chalk.gray(`   Formats: ${detectedFiles.formats.join(', ')}`));
      console.log(chalk.gray(`   Paths: ${detectedFiles.paths.join(', ')}`));
      if (detectedFiles.detectedLocales && detectedFiles.detectedLocales.length > 0) {
        console.log(chalk.gray(`   Detected locales: ${detectedFiles.detectedLocales.join(', ')}\n`));
      } else {
        console.log('');
      }
    }

    const questions: any[] = [
      {
        type: 'input',
        name: 'flutterLocalesPath',
        message: 'Path to your localization files:',
        default: detectedFiles.suggestedPath,
        validate: async (input: string) => {
          const fullPath = path.join(this.cwd, input);
          try {
            await fs.access(fullPath);
            return true;
          } catch {
            return `Directory "${input}" does not exist. Should I create it? (y/n)`;
          }
        }
      },
      {
        type: 'list',
        name: 'fileFormat',
        message: 'File format:',
        choices: [
          { name: 'Auto-detect (recommended)', value: 'auto' },
          { name: 'ARB (Flutter Application Resource Bundle)', value: 'arb' },
          { name: 'JSON (JavaScript Object Notation)', value: 'json' },
          { name: 'YAML (YAML Ain\'t Markup Language)', value: 'yaml' },
          { name: 'CSV (Comma-Separated Values)', value: 'csv' },
          { name: 'TSV (Tab-Separated Values)', value: 'tsv' }
        ],
        default: detectedFiles.suggestedFormat === 'arb' ? 1 :
                 detectedFiles.suggestedFormat === 'json' ? 2 :
                 detectedFiles.suggestedFormat === 'yaml' ? 3 :
                 detectedFiles.suggestedFormat === 'csv' ? 4 : 0
      },
      {
        type: 'input',
        name: 'sourceLocale',
        message: 'Source locale (e.g., en, en_US):',
        default: detectedFiles.suggestedSourceLocale || 'en',
        validate: (input: any) => {
          const inputStr = String(input || '');
          if (!inputStr.trim()) return 'Source locale is required';
          if (!/^[a-z]{2,3}([_-][A-Z]{2})?$/.test(inputStr)) {
            return 'Please enter a valid locale code (e.g., en, es, en_US, pt_BR)';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'targetLocales',
        message: 'Target locales (comma-separated, e.g., es,fr,de):',
        default: detectedFiles.suggestedTargetLocales && detectedFiles.suggestedTargetLocales.length > 0 
          ? detectedFiles.suggestedTargetLocales.join(',') 
          : (detectedFiles.formats.length > 0 ? 'es,fr' : ''),
        validate: (input: any) => {
          const inputStr = String(input || '');
          if (!inputStr.trim()) return 'At least one target locale is required';
          const locales = inputStr.split(',').map(l => l.trim());
          for (const locale of locales) {
            if (!/^[a-z]{2,3}([_-][A-Z]{2})?$/.test(locale)) {
              return `Invalid locale: ${locale}. Use format like: es,fr,de or en_US,pt_BR`;
            }
          }
          return true;
        },
        filter: (input: any) => String(input || '').split(',').map(l => l.trim()).filter(Boolean)
      }
    ];

    return await inquirer.prompt(questions);
  }

  private async collectAdvancedConfig(basicConfig: any): Promise<Partial<LocalzConfig>> {
    console.log(chalk.blue('\n⚙️  Advanced Configuration'));
    
    const questions: any[] = [
      {
        type: 'confirm',
        name: 'doAutoFix',
        message: 'Enable automatic fixes for common issues?',
        default: true
      },
      {
        type: 'list',
        name: 'preferOrder',
        message: 'Key ordering preference:',
        choices: [
          { name: 'Mirror source locale order', value: 'mirror-source' },
          { name: 'Alphabetical order', value: 'alphabetical' }
        ],
        default: 'mirror-source'
      },
      {
        type: 'confirm',
        name: 'autoUpdate',
        message: 'Enable automatic updates?',
        default: true
      }
    ];

    // Add CSV-specific questions
    if (basicConfig.fileFormat === 'csv' || basicConfig.fileFormat === 'tsv') {
      questions.push(
        {
          type: 'input',
          name: 'csvKeyColumn',
          message: 'CSV key column name:',
          default: 'key'
        },
        {
          type: 'input',
          name: 'csvDelimiter',
          message: 'CSV delimiter:',
          default: basicConfig.fileFormat === 'tsv' ? '\\t' : ',',
          validate: (input: any) => String(input || '').length > 0 ? true : 'Delimiter cannot be empty'
        }
      );
    }

    const answers = await inquirer.prompt(questions);

    // Transform CSV answers to proper structure
    if (answers.csvKeyColumn || answers.csvDelimiter) {
      answers.csvOptions = {
        keyColumn: answers.csvKeyColumn,
        delimiter: answers.csvDelimiter === '\\t' ? '\t' : answers.csvDelimiter,
        valueColumns: basicConfig.targetLocales.reduce((acc: any, locale: string) => {
          acc[locale] = locale;
          return acc;
        }, { [basicConfig.sourceLocale]: basicConfig.sourceLocale })
      };
      delete answers.csvKeyColumn;
      delete answers.csvDelimiter;
    }

    return answers;
  }

  private async collectTranslationConfig(): Promise<Partial<LocalzConfig & { geminiApiKey?: string }>> {
    console.log(chalk.blue('\n🤖 AI Translation Setup (Optional)'));
    console.log(chalk.gray('Enable AI-powered translation of missing keys using Google Gemini.\n'));

    const questions: any[] = [
      {
        type: 'confirm',
        name: 'translateMissing',
        message: 'Enable AI translation for missing keys?',
        default: false
      },
      {
        type: 'input',
        name: 'geminiApiKey',
        message: 'Google Gemini API key (will be saved to .env):',
        when: (answers: any) => answers.translateMissing,
        validate: (input: any) => {
          const inputStr = String(input || '');
          if (!inputStr.trim()) return 'API key is required for translation';
          if (inputStr.length < 20) return 'API key seems too short';
          return true;
        }
      },
      {
        type: 'list',
        name: 'geminiModel',
        message: 'Gemini model:',
        when: (answers: any) => answers.translateMissing,
        choices: [
          { name: 'gemini-2.5-pro (recommended)', value: 'gemini-2.5-pro' },
          { name: 'gemini-1.5-flash (faster)', value: 'gemini-1.5-flash' },
          { name: 'gemini-pro', value: 'gemini-pro' }
        ],
        default: 'gemini-2.5-pro'
      },
      {
        type: 'input',
        name: 'styleGuidelines',
        message: 'Style guidelines for translation (optional):',
        when: (answers: any) => answers.translateMissing,
        default: 'Concise UI text, sentence case, no trailing punctuation for buttons'
      }
    ];

    return await inquirer.prompt(questions);
  }

  private async createConfigFile(config: LocalzConfig & { geminiApiKey?: string }): Promise<void> {
    const configFile = path.join(this.cwd, 'zlocalz.config.json');
    
    // Remove API key from config file (will be in .env)
    const { geminiApiKey, ...configWithoutKey } = config;
    
    const configContent = JSON.stringify(configWithoutKey, null, 2);
    
    try {
      await fs.writeFile(configFile, configContent);
      console.log(chalk.green(`\n✅ Created configuration file: ${configFile}`));
    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to create config file: ${error}`));
      throw error;
    }
  }

  private async createEnvFile(apiKey: string): Promise<void> {
    const envFile = path.join(this.cwd, '.env');
    const envContent = `# ZLocalz Configuration\nGEMINI_API_KEY=${apiKey}\n`;
    
    try {
      // Check if .env already exists
      let existingContent = '';
      try {
        existingContent = await fs.readFile(envFile, 'utf-8');
      } catch (error) {
        // File doesn't exist, that's fine
      }

      if (existingContent && !existingContent.includes('GEMINI_API_KEY')) {
        // Append to existing .env
        await fs.writeFile(envFile, existingContent + '\n' + envContent);
        console.log(chalk.green(`✅ Added GEMINI_API_KEY to existing .env file`));
      } else if (!existingContent) {
        // Create new .env
        await fs.writeFile(envFile, envContent);
        console.log(chalk.green(`✅ Created .env file with API key`));
      } else {
        console.log(chalk.yellow(`⚠️  GEMINI_API_KEY already exists in .env`));
      }

      // Add .env to .gitignore if it exists
      await this.addToGitignore('.env');
      
    } catch (error) {
      console.log(chalk.red(`❌ Failed to create .env file: ${error}`));
      throw error;
    }
  }

  private async addToGitignore(entry: string): Promise<void> {
    const gitignorePath = path.join(this.cwd, '.gitignore');
    
    try {
      let gitignoreContent = '';
      try {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      } catch (error) {
        // .gitignore doesn't exist, create it
      }

      if (!gitignoreContent.includes(entry)) {
        const newContent = gitignoreContent ? 
          gitignoreContent + '\n' + entry + '\n' : 
          entry + '\n';
        
        await fs.writeFile(gitignorePath, newContent);
        console.log(chalk.green(`✅ Added ${entry} to .gitignore`));
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Could not update .gitignore: ${error}`));
    }
  }

  private showSetupComplete(config: LocalzConfig): void {
    console.log(chalk.green('\n🎉 Setup Complete!'));
    console.log(chalk.gray('─'.repeat(50)));
    
    console.log(chalk.blue('\n📋 Configuration Summary:'));
    console.log(chalk.gray(`   Path: ${config.flutterLocalesPath}`));
    console.log(chalk.gray(`   Format: ${config.fileFormat}`));
    console.log(chalk.gray(`   Source: ${config.sourceLocale}`));
    console.log(chalk.gray(`   Targets: ${config.targetLocales.join(', ')}`));
    console.log(chalk.gray(`   Auto-fix: ${config.doAutoFix ? 'enabled' : 'disabled'}`));
    console.log(chalk.gray(`   Auto-update: ${config.autoUpdate ? 'enabled' : 'disabled'}`));
    console.log(chalk.gray(`   Translation: ${config.translateMissing ? 'enabled' : 'disabled'}`));

    console.log(chalk.blue('\n🚀 Next Steps:'));
    console.log(chalk.white('   1. ') + chalk.gray('ZLocalz will now launch the TUI interface'));
    console.log(chalk.white('   2. ') + chalk.gray('Use the interface to validate and fix your localization files'));
    console.log(chalk.white('   3. ') + chalk.gray('Press ? in the TUI for help and keyboard shortcuts'));
    
    if (config.translateMissing) {
      console.log(chalk.white('   4. ') + chalk.gray('Use the translate feature (t key) for missing translations'));
    }

    console.log(chalk.blue('\n💡 Pro Tips:'));
    console.log(chalk.gray('   • Run "zlocalz scan" anytime to launch the TUI'));
    console.log(chalk.gray('   • Use "zlocalz --help" to see all available commands'));
    console.log(chalk.gray('   • Edit zlocalz.config.json to modify settings'));
    
    console.log(chalk.green('\n   Starting ZLocalz TUI in 3 seconds...'));
  }
}