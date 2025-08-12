import * as blessed from 'blessed';
import { LocalzConfig, LocaleFile, ValidationIssue, IssueType } from '../types';
import { EventEmitter } from 'events';

export interface AppState {
  config: LocalzConfig;
  sourceFile?: LocaleFile;
  targetFiles: Map<string, LocaleFile>;
  currentLocale?: string;
  currentKey?: string;
  issues: Map<string, ValidationIssue[]>;
  selectedKeys: Set<string>;
  filter?: IssueType;
  unsavedChanges: boolean;
  isLoading: boolean;
  error?: string;
  focusedPane: 'files' | 'keys' | 'details';
}

export class LocalzApp extends EventEmitter {
  private screen!: blessed.Widgets.Screen;
  private state: AppState;
  private initialized: boolean = false;
  private updating: boolean = false;
  
  // UI Components
  private header!: blessed.Widgets.BoxElement;
  private footer!: blessed.Widgets.BoxElement;
  private mainContainer!: blessed.Widgets.BoxElement;
  
  // Panes
  private filesPane!: blessed.Widgets.BoxElement;
  private keysPane!: blessed.Widgets.BoxElement;
  private detailsPane!: blessed.Widgets.BoxElement;
  
  // Lists and displays
  private filesList!: blessed.Widgets.ListElement;
  private keysList!: blessed.Widgets.ListElement;
  private detailsText!: blessed.Widgets.TextElement;
  
  // Overlays
  private loadingScreen!: blessed.Widgets.BoxElement;
  private helpModal!: blessed.Widgets.BoxElement;
  private errorModal!: blessed.Widgets.BoxElement;

  constructor(config: LocalzConfig) {
    super();
    
    this.state = {
      config,
      targetFiles: new Map(),
      issues: new Map(),
      selectedKeys: new Set(),
      unsavedChanges: false,
      isLoading: true,
      focusedPane: 'files'
    };

    try {
      this.initializeScreen();
      this.createUI();
      this.setupEventHandlers();
      this.initialized = true;
    } catch (error) {
      this.handleFatalError(error);
    }
  }

  private initializeScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: 'ZLocalz - Universal Locale Guardian',
      dockBorders: false,
      warnings: false
    });

    // Handle screen events
    this.screen.on('error', (err) => {
      this.handleFatalError(err);
    });

    this.screen.on('resize', () => {
      this.handleResize();
    });

    // Handle process signals gracefully
    process.on('SIGINT', () => this.handleExit());
    process.on('SIGTERM', () => this.handleExit());
    process.on('uncaughtException', (err) => this.handleFatalError(err));
  }

  private createUI(): void {
    this.createLayout();
    this.createComponents();
    this.setupKeyBindings();
    this.showLoading();
  }

  private createLayout(): void {
    // Header (status bar)
    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' ZLocalz - Loading...',
      style: {
        fg: 'white',
        bg: 'blue'
      },
      tags: true
    });

    // Main container
    this.mainContainer = blessed.box({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '100%',
      height: '100%-2',
      style: {
        bg: 'black'
      }
    });

    // Footer (shortcuts)
    this.footer = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' Press ? for help | q to quit',
      style: {
        fg: 'white',
        bg: 'blue'
      },
      tags: true
    });
  }

  private createComponents(): void {
    this.createMainPanes();
    this.createOverlays();
  }

  private createMainPanes(): void {
    // Files pane (left - 25%)
    this.filesPane = blessed.box({
      parent: this.mainContainer,
      label: ' 📁 Locales ',
      top: 0,
      left: 0,
      width: '25%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'gray' },
        label: { fg: 'white', bold: true }
      },
      tags: true
    });

    this.filesList = blessed.list({
      parent: this.filesPane,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      keys: true,
      mouse: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' }
      },
      scrollbar: {
        ch: '█',
        style: { bg: 'gray' }
      }
    });

    // Keys pane (middle - 45%)
    this.keysPane = blessed.box({
      parent: this.mainContainer,
      label: ' 🔑 Translation Keys ',
      top: 0,
      left: '25%',
      width: '45%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'gray' },
        label: { fg: 'white', bold: true }
      },
      tags: true
    });

    this.keysList = blessed.list({
      parent: this.keysPane,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      keys: true,
      mouse: true,
      style: {
        selected: { bg: 'green', fg: 'white' },
        item: { fg: 'white' }
      },
      scrollbar: {
        ch: '█',
        style: { bg: 'gray' }
      }
    });

    // Details pane (right - 30%)
    this.detailsPane = blessed.box({
      parent: this.mainContainer,
      label: ' 🔍 Details & Issues ',
      top: 0,
      left: '70%',
      width: '30%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'gray' },
        label: { fg: 'white', bold: true }
      },
      tags: true
    });

    this.detailsText = blessed.text({
      parent: this.detailsPane,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      content: 'Select a key to view details',
      style: { fg: 'white' },
      tags: true,
      wrap: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '█',
        style: { bg: 'gray' }
      }
    });
  }

  private createOverlays(): void {
    // Loading screen
    this.loadingScreen = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 10,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        bg: 'black'
      },
      content: `{center}{bold}🚀 ZLocalz Loading...{/bold}

{cyan-fg}Initializing locale files...{/cyan-fg}

Please wait...{/center}`,
      tags: true,
      hidden: false
    });

    // Help modal
    this.helpModal = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        bg: 'black'
      },
      label: ' 📖 ZLocalz Help ',
      content: this.getHelpContent(),
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      hidden: true
    });

    // Error modal
    this.errorModal = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      border: { type: 'line' },
      style: {
        border: { fg: 'red' },
        bg: 'black'
      },
      label: ' ❌ Error ',
      content: '',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      hidden: true
    });
  }

  private setupEventHandlers(): void {
    // File selection
    this.filesList.on('select item', (_item: any, index: number) => {
      this.selectLocale(index);
    });

    // Key selection
    this.keysList.on('select item', (_item: any, index: number) => {
      this.selectKey(index);
    });

    // Focus handling - removed to prevent recursion
    // The focus state is now managed manually through cycleFocus()
  }

  private setupKeyBindings(): void {
    // Global shortcuts
    this.screen.key(['q', 'C-c'], () => this.handleExit());
    this.screen.key(['?', 'h', 'F1'], () => this.showHelp());
    this.screen.key(['escape'], () => this.hideModals());
    
    // Navigation
    this.screen.key(['tab'], () => this.cycleFocus());
    this.screen.key(['S-tab'], () => this.cycleFocus(true));
    
    // Actions (only if not loading)
    this.screen.key(['r'], () => this.refresh());
    this.screen.key(['s'], () => this.save());
    this.screen.key(['space'], () => this.toggleSelection());
    
    // Filters
    this.screen.key(['1'], () => this.setFilter('missing'));
    this.screen.key(['2'], () => this.setFilter('extra'));
    this.screen.key(['3'], () => this.setFilter('icuError'));
    this.screen.key(['0'], () => this.clearFilter());
  }

  // Event handlers
  private selectLocale(index: number): void {
    if (this.state.isLoading) return;
    
    try {
      const locales = Array.from(this.state.targetFiles.keys()).sort();
      if (index >= 0 && index < locales.length) {
        this.state.currentLocale = locales[index];
        this.state.currentKey = undefined;
        this.updateKeysList();
        this.updateDetails();
        this.updateHeader();
      }
    } catch (error) {
      this.showError('Failed to select locale', error);
    }
  }

  private selectKey(index: number): void {
    if (this.state.isLoading || !this.state.currentLocale) return;
    
    try {
      const keys = this.getFilteredKeys();
      if (index >= 0 && index < keys.length) {
        this.state.currentKey = keys[index];
        this.updateDetails();
      }
    } catch (error) {
      this.showError('Failed to select key', error);
    }
  }

  private cycleFocus(reverse: boolean = false): void {
    if (this.state.isLoading) return;
    
    const panes = ['files', 'keys', 'details'] as const;
    const currentIndex = panes.indexOf(this.state.focusedPane);
    const nextIndex = reverse 
      ? (currentIndex - 1 + panes.length) % panes.length
      : (currentIndex + 1) % panes.length;
    
    this.state.focusedPane = panes[nextIndex];
    this.updateFocus();
  }

  private updateFocus(): void {
    if (this.updating) return;
    
    try {
      this.updating = true;
      
      // Reset borders
      if (this.filesPane?.style?.border) this.filesPane.style.border.fg = 'gray';
      if (this.keysPane?.style?.border) this.keysPane.style.border.fg = 'gray';  
      if (this.detailsPane?.style?.border) this.detailsPane.style.border.fg = 'gray';
      
      // Highlight active pane and focus without triggering recursion
      switch (this.state.focusedPane) {
        case 'files':
          if (this.filesPane?.style?.border) this.filesPane.style.border.fg = 'cyan';
          if (this.filesList && typeof this.filesList.focus === 'function') {
            // Focus without triggering events
            this.screen.focusPush(this.filesList);
          }
          this.updateFooter('Tab: Next pane | Enter: Select | ?: Help | q: Quit');
          break;
        case 'keys':
          if (this.keysPane?.style?.border) this.keysPane.style.border.fg = 'cyan';
          if (this.keysList && typeof this.keysList.focus === 'function') {
            // Focus without triggering events
            this.screen.focusPush(this.keysList);
          }
          this.updateFooter('Space: Select | 1-3: Filter | 0: Clear filter | r: Refresh | s: Save');
          break;
        case 'details':
          if (this.detailsPane?.style?.border) this.detailsPane.style.border.fg = 'cyan';
          if (this.detailsText && typeof this.detailsText.focus === 'function') {
            // Focus without triggering events
            this.screen.focusPush(this.detailsText);
          }
          this.updateFooter('↑↓: Scroll | Tab: Next pane | ESC: Back');
          break;
      }
      
      if (this.screen && typeof this.screen.render === 'function') {
        this.screen.render();
      }
    } catch (error) {
      // Prevent recursion by not calling other update methods
      console.error('Focus update error:', error);
    } finally {
      this.updating = false;
    }
  }

  private toggleSelection(): void {
    if (!this.state.currentKey || this.state.isLoading) return;
    
    if (this.state.selectedKeys.has(this.state.currentKey)) {
      this.state.selectedKeys.delete(this.state.currentKey);
    } else {
      this.state.selectedKeys.add(this.state.currentKey);
    }
    
    this.updateKeysList();
  }

  private setFilter(filterType: IssueType): void {
    this.state.filter = this.state.filter === filterType ? undefined : filterType;
    this.updateKeysList();
    this.updateHeader();
  }

  private clearFilter(): void {
    this.state.filter = undefined;
    this.updateKeysList();
    this.updateHeader();
  }

  private refresh(): void {
    if (this.state.isLoading) return;
    this.emit('refresh');
  }

  private save(): void {
    if (this.state.isLoading) return;
    this.emit('save');
    this.state.unsavedChanges = false;
    this.updateHeader();
  }

  // UI Updates
  private updateHeader(): void {
    const locale = this.state.currentLocale || 'No locale';
    const issueCount = this.getIssueCount();
    const changes = this.state.unsavedChanges ? ' •' : '';
    const filter = this.state.filter ? ` | Filter: ${this.state.filter}` : '';
    
    this.header.setContent(
      ` ZLocalz | Locale: ${locale} | Issues: ${issueCount}${filter}${changes}`
    );
    this.screen.render();
  }

  private updateFooter(content: string): void {
    this.footer.setContent(` ${content}`);
    this.screen.render();
  }

  private updateFilesList(): void {
    try {
      const locales = Array.from(this.state.targetFiles.keys()).sort();
      const items = locales.map(locale => {
        const issues = this.state.issues.get(locale)?.length || 0;
        const indicator = issues > 0 ? ` (${issues} issues)` : ' ✓';
        return `📄 ${locale}${indicator}`;
      });
      
      this.filesList.setItems(items);
      
      // Auto-select first locale if none selected
      if (locales.length > 0 && !this.state.currentLocale) {
        this.state.currentLocale = locales[0];
        this.filesList.select(0);
        this.updateKeysList();
      }
      
      this.screen.render();
    } catch (error) {
      this.showError('Failed to update files list', error);
    }
  }

  private updateKeysList(): void {
    if (!this.state.currentLocale) return;
    
    try {
      const keys = this.getFilteredKeys();
      const items = keys.map(key => {
        const selected = this.state.selectedKeys.has(key) ? '✓ ' : '  ';
        const issues = this.getKeyIssues(key);
        const indicator = issues.length > 0 ? ' ⚠️' : '';
        return `${selected}${key}${indicator}`;
      });
      
      this.keysList.setItems(items);
      this.screen.render();
    } catch (error) {
      this.showError('Failed to update keys list', error);
    }
  }

  private updateDetails(): void {
    try {
      if (!this.state.currentKey || !this.state.currentLocale) {
        this.detailsText.setContent('Select a key to view details');
        this.screen.render();
        return;
      }

      const key = this.state.currentKey;
      const locale = this.state.currentLocale;
      const value = this.getKeyValue(key, locale);
      const issues = this.getKeyIssues(key);
      
      let content = `{bold}Key:{/bold} ${key}\n`;
      content += `{bold}Locale:{/bold} ${locale}\n`;
      content += `{bold}Value:{/bold} ${value || '{red-fg}(missing){/red-fg}'}\n\n`;
      
      if (issues.length > 0) {
        content += `{bold}Issues:{/bold}\n`;
        issues.forEach(issue => {
          const severity = issue.severity === 'error' ? '{red-fg}ERROR{/red-fg}' : '{yellow-fg}WARN{/yellow-fg}';
          content += `• ${severity}: ${issue.message}\n`;
        });
      } else {
        content += `{green-fg}✅ No issues found{/green-fg}`;
      }
      
      this.detailsText.setContent(content);
      this.screen.render();
    } catch (error) {
      this.showError('Failed to update details', error);
    }
  }

  // Helper methods
  private getFilteredKeys(): string[] {
    if (!this.state.currentLocale) return [];
    
    const file = this.state.targetFiles.get(this.state.currentLocale);
    if (!file) return [];
    
    let keys = Object.keys(file.entries);
    
    if (this.state.filter) {
      const issues = this.state.issues.get(this.state.currentLocale) || [];
      const filteredIssues = issues.filter(issue => issue.type === this.state.filter);
      keys = keys.filter(key => filteredIssues.some(issue => issue.key === key));
    }
    
    return keys.sort();
  }

  private getKeyIssues(key: string): ValidationIssue[] {
    if (!this.state.currentLocale) return [];
    const issues = this.state.issues.get(this.state.currentLocale) || [];
    return issues.filter(issue => issue.key === key);
  }

  private getKeyValue(key: string, locale: string): string | undefined {
    const file = this.state.targetFiles.get(locale);
    return file?.entries[key]?.value;
  }

  private getIssueCount(): number {
    if (!this.state.currentLocale) return 0;
    const issues = this.state.issues.get(this.state.currentLocale) || [];
    return this.state.filter 
      ? issues.filter(issue => issue.type === this.state.filter).length
      : issues.length;
  }

  // Modal management
  private showLoading(): void {
    this.loadingScreen.show();
    this.screen.render();
  }

  private hideLoading(): void {
    this.state.isLoading = false;
    this.loadingScreen.hide();
    this.updateFocus();
    this.screen.render();
  }

  private showHelp(): void {
    this.helpModal.show();
    this.helpModal.focus();
    this.screen.render();
  }

  private hideModals(): void {
    this.helpModal.hide();
    this.errorModal.hide();
    this.updateFocus();
  }

  private showError(title: string, error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const content = `{center}{bold}${title}{/bold}{/center}

{red-fg}${errorMessage}{/red-fg}

{center}Press ESC to close{/center}`;
    
    this.errorModal.setContent(content);
    this.errorModal.show();
    this.errorModal.focus();
    this.screen.render();
  }

  private handleResize(): void {
    try {
      this.screen.render();
    } catch (error) {
      // Ignore resize errors
    }
  }

  private handleExit(): void {
    if (this.state.unsavedChanges) {
      // In a real app, we'd show a confirmation dialog
      // For now, just exit
    }
    
    try {
      this.screen.destroy();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    process.exit(0);
  }

  private handleFatalError(error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    try {
      if (this.screen) {
        this.screen.destroy();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    
    console.error('\n❌ ZLocalz TUI Fatal Error:');
    console.error(errorMessage);
    console.error('\n💡 Try running with --no-tui flag for command-line mode');
    process.exit(1);
  }

  private getHelpContent(): string {
    return `{center}{bold}🚀 ZLocalz - Universal Locale Guardian{/bold}{/center}

{bold}NAVIGATION{/bold}
• Tab / Shift+Tab     Cycle between panes
• ↑↓ / j k           Navigate lists
• Enter              Select item
• ESC                Close modals / go back
• q / Ctrl+C         Quit application

{bold}ACTIONS{/bold}  
• Space              Select/deselect key
• r                  Refresh data
• s                  Save changes
• ?                  Show this help

{bold}FILTERS{/bold}
• 1                  Show missing keys only
• 2                  Show extra keys only
• 3                  Show ICU errors only
• 0                  Clear all filters

{bold}VISUAL INDICATORS{/bold}
• ✓                  Selected key
• ⚠️                  Key has issues
• •                  Unsaved changes
• (N issues)         Issue count per locale

{bold}PANES{/bold}
• Left: Locale files with issue counts
• Middle: Translation keys with status
• Right: Selected key details and issues

{center}Press ESC to close help{/center}`;
  }

  // Public API
  public async initialize(sourceFile: LocaleFile, targetFiles: LocaleFile[]): Promise<void> {
    try {
      this.state.sourceFile = sourceFile;
      this.state.targetFiles = new Map(targetFiles.map(file => [file.locale, file]));
      
      this.updateFilesList();
      this.updateKeysList();
      this.updateDetails();
      this.updateHeader();
      
      this.hideLoading();
      
      // Emit ready event
      this.emit('ready');
    } catch (error) {
      this.handleFatalError(error);
    }
  }

  public updateIssues(issues: Map<string, ValidationIssue[]>): void {
    try {
      this.state.issues = issues;
      this.updateFilesList();
      this.updateKeysList();
      this.updateDetails();
      this.updateHeader();
    } catch (error) {
      this.showError('Failed to update issues', error);
    }
  }

  public render(): void {
    if (!this.initialized) return;
    
    try {
      this.screen.render();
    } catch (error) {
      this.handleFatalError(error);
    }
  }

  public destroy(): void {
    try {
      if (this.screen) {
        this.screen.destroy();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}