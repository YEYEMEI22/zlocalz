import updateNotifier from 'update-notifier';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

export class ZLocalzUpdater {
  private packageJson: any;
  private notifier: any;
  private autoUpdateEnabled: boolean = true;

  constructor(autoUpdateEnabled: boolean = true) {
    this.autoUpdateEnabled = autoUpdateEnabled;
    this.initializeUpdater();
  }

  private async initializeUpdater(): Promise<void> {
    try {
      // Try to get package info from require first
      try {
        this.packageJson = require('../../package.json');
      } catch (error) {
        // Fallback to reading from file system
        const packagePath = path.join(__dirname, '../../package.json');
        const packageContent = await fs.readFile(packagePath, 'utf-8');
        this.packageJson = JSON.parse(packageContent);
      }

      // Ensure we have required package info
      if (!this.packageJson?.name || !this.packageJson?.version) {
        this.packageJson = { name: 'zlocalz', version: '1.0.2' }; // Fallback
      }

      // Create update notifier
      this.notifier = updateNotifier({
        pkg: this.packageJson,
        updateCheckInterval: 1000 * 60 * 60 * 24, // 24 hours
        shouldNotifyInNpmScript: false
      });

      this.setupAutoUpdate();
    } catch (error) {
      // Silently fail if we can't set up updates
      console.debug('Update notifier setup failed:', error);
    }
  }

  private setupAutoUpdate(): void {
    // Check for updates and notify or auto-update
    if (this.notifier?.update) {
      if (this.autoUpdateEnabled) {
        // Perform silent automatic update
        this.performSilentUpdate();
      } else {
        this.displayUpdateNotification();
      }
    }
  }

  private async performSilentUpdate(): Promise<void> {
    try {
      const { latest, type } = this.notifier.update;
      
      // Only auto-update for patch and minor releases, ask for major
      if (type === 'major') {
        this.displayUpdateNotification();
        return;
      }

      console.log(chalk.blue(`🔄 Auto-updating ZLocalz to ${latest}...`));
      
      const success = await this.performAutoUpdate(true);
      if (success) {
        console.log(chalk.green('✅ ZLocalz updated successfully in the background!'));
      }
    } catch (error) {
      // Silently fall back to notification if auto-update fails
      this.displayUpdateNotification();
    }
  }

  private displayUpdateNotification(): void {
    const { current, latest, type } = this.notifier.update;
    
    console.log(chalk.yellow('┌─────────────────────────────────────────────────────┐'));
    console.log(chalk.yellow('│') + '  📦 ZLocalz Update Available!                     ' + chalk.yellow('│'));
    console.log(chalk.yellow('│') + `  Current: ${chalk.red(current)}                          ` + chalk.yellow('│'));
    console.log(chalk.yellow('│') + `  Latest:  ${chalk.green(latest)}                          ` + chalk.yellow('│'));
    console.log(chalk.yellow('│') + `  Type:    ${this.getUpdateTypeEmoji(type)} ${type}                    ` + chalk.yellow('│'));
    console.log(chalk.yellow('│') + '                                                     ' + chalk.yellow('│'));
    console.log(chalk.yellow('│') + '  Run the following to update:                      ' + chalk.yellow('│'));
    console.log(chalk.yellow('│') + `  ${chalk.cyan('npm install -g zlocalz@latest')}                 ` + chalk.yellow('│'));
    console.log(chalk.yellow('│') + '                                                     ' + chalk.yellow('│'));
    console.log(chalk.yellow('│') + '  Or use our auto-update command:                   ' + chalk.yellow('│'));
    console.log(chalk.yellow('│') + `  ${chalk.cyan('zlocalz --update')}                              ` + chalk.yellow('│'));
    console.log(chalk.yellow('└─────────────────────────────────────────────────────┘'));
    console.log('');
  }

  private getUpdateTypeEmoji(type: string): string {
    switch (type) {
      case 'major':
        return '🚀';
      case 'minor':
        return '✨';
      case 'patch':
        return '🐛';
      default:
        return '📦';
    }
  }

  public async checkForUpdates(): Promise<void> {
    await this.initializeUpdater();
  }

  public async performAutoUpdate(silent: boolean = false): Promise<boolean> {
    try {
      if (!silent) {
        console.log(chalk.blue('🔄 Checking for ZLocalz updates...'));
      }
      
      // Force check for updates
      this.notifier = updateNotifier({
        pkg: this.packageJson,
        updateCheckInterval: 0 // Force immediate check
      });

      if (!this.notifier.update) {
        if (!silent) {
          console.log(chalk.green('✅ ZLocalz is already up to date!'));
        }
        return true;
      }

      const { latest } = this.notifier.update;
      if (!silent) {
        console.log(chalk.yellow(`📦 Update available: ${latest}`));
        console.log(chalk.blue('🔄 Updating ZLocalz...'));
      }

      // Use npm to update the package
      const { spawn } = require('child_process');
      
      return new Promise((resolve, reject) => {
        const updateProcess = spawn('npm', ['install', '-g', `zlocalz@${latest}`], {
          stdio: silent ? 'pipe' : 'inherit' // Hide output for silent updates
        });

        let output = '';
        if (silent) {
          updateProcess.stdout?.on('data', (data: any) => {
            output += data.toString();
          });
          updateProcess.stderr?.on('data', (data: any) => {
            output += data.toString();
          });
        }

        updateProcess.on('close', (code: number) => {
          if (code === 0) {
            if (!silent) {
              console.log(chalk.green('✅ ZLocalz updated successfully!'));
              console.log(chalk.yellow('🔄 Please restart your terminal or run `zlocalz --version` to verify.'));
            }
            
            // Store update info for next run
            this.saveUpdateInfo(latest);
            resolve(true);
          } else {
            if (!silent) {
              console.log(chalk.red('❌ Update failed. Please run manually: npm install -g zlocalz@latest'));
            }
            reject(new Error(`Update process exited with code ${code}`));
          }
        });

        updateProcess.on('error', (error: Error) => {
          if (!silent) {
            console.log(chalk.red('❌ Update failed:', error.message));
            console.log(chalk.yellow('Please run manually: npm install -g zlocalz@latest'));
          }
          reject(error);
        });
      });
    } catch (error) {
      if (!silent) {
        console.log(chalk.red('❌ Auto-update failed:', error));
        console.log(chalk.yellow('Please run manually: npm install -g zlocalz@latest'));
      }
      return false;
    }
  }

  public getChangelogUrl(): string {
    return `https://github.com/bllfoad/zlocalz/releases/tag/v${this.packageJson?.version}`;
  }

  private async saveUpdateInfo(version: string): Promise<void> {
    try {
      const os = require('os');
      const updateInfoPath = path.join(os.homedir(), '.zlocalz-update');
      const updateInfo = {
        lastUpdate: new Date().toISOString(),
        version,
        autoUpdated: true
      };
      await fs.writeFile(updateInfoPath, JSON.stringify(updateInfo, null, 2));
    } catch (error) {
      // Ignore errors saving update info
    }
  }

  public async getUpdateInfo(): Promise<any> {
    try {
      const os = require('os');
      const updateInfoPath = path.join(os.homedir(), '.zlocalz-update');
      const content = await fs.readFile(updateInfoPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  public async showReleaseNotes(): Promise<void> {
    if (!this.notifier?.update) {
      console.log(chalk.green('No updates available.'));
      return;
    }

    console.log(chalk.blue('📋 Recent Changes:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.yellow(`🔗 Full changelog: ${this.getChangelogUrl()}`));
    console.log('');
    
    // Show if last update was automatic
    const updateInfo = await this.getUpdateInfo();
    if (updateInfo?.autoUpdated) {
      console.log(chalk.green(`✅ Last auto-update: ${updateInfo.lastUpdate} (v${updateInfo.version})`));
    }
  }

  public async showWelcomeMessage(): Promise<void> {
    const updateInfo = await this.getUpdateInfo();
    if (updateInfo?.autoUpdated && updateInfo.version) {
      console.log(chalk.green(`✨ ZLocalz auto-updated to v${updateInfo.version}!`));
      console.log(chalk.blue('🔗 What\'s new: ') + this.getChangelogUrl());
      console.log('');
      
      // Clear the auto-update flag
      updateInfo.autoUpdated = false;
      const os = require('os');
      const updateInfoPath = path.join(os.homedir(), '.zlocalz-update');
      await fs.writeFile(updateInfoPath, JSON.stringify(updateInfo, null, 2)).catch(() => {});
    }
  }
}