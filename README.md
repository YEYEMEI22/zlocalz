# ZLocalz - Universal TUI Locale Guardian

A powerful Terminal User Interface (TUI) application for managing Flutter localization files in multiple formats. ZLocalz supports ARB, JSON, YAML, CSV, and TSV files, ensuring perfect synchronization between your source locale and target translations with automatic validation, fixing, and AI-powered translation capabilities.

Repository: [github.com/bllfoad/zlocalz](https://github.com/bllfoad/zlocalz)

> ⚠️ Beta: ZLocalz is currently in beta and may have issues. If you run into problems, please open an issue via the CLI with `zlocalz issue --new` or visit the issues page at [github.com/bllfoad/zlocalz/issues](https://github.com/bllfoad/zlocalz/issues).

## Features

### 📁 Universal Format Support
- **ARB Files**: Native Flutter Application Resource Bundle support
- **JSON Files**: Standard JSON localization format
- **YAML Files**: Hierarchical YAML with metadata support  
- **CSV/TSV**: Multi-locale spreadsheet format for easy editing
- **Auto-Detection**: Automatically detects and handles mixed formats

### 🔍 Smart Validation
- Detect missing keys, extra keys, duplicates, ICU errors, placeholder mismatches, and formatting issues
- Format-specific validation rules
- Cross-format compatibility checks

### 🔧 Intelligent Auto-Fix
- Automatically fix common issues while preserving translations
- Format-aware corrections (JSON, YAML, CSV structure preservation)
- Configurable key ordering (source-mirror or alphabetical)

### 🤖 AI Translation
- Translate missing keys using Google Gemini with context awareness
- Preserve ICU message format and placeholders
- Domain glossary and style guidelines support

### 📊 Powerful TUI
- 3-pane interface: file tree, key list, and inspector
- Format-specific syntax highlighting
- Multi-format diff viewer

### 🎯 Advanced Operations  
- Batch operations across multiple formats
- Multi-step undo/redo for safe experimentation
- Export to different formats
- Git integration for change tracking

### 🔄 Automatic Update System
- **Fully Automatic**: Updates install automatically for patch/minor releases
- **Smart Updates**: Major version changes require user confirmation
- **Background Process**: Updates happen silently without interrupting workflow
- **Manual Control**: `zlocalz update` for immediate updates
- **Configurable**: Disable with `"autoUpdate": false` in config
- **Welcome Messages**: Shows what's new after auto-updates

## Installation

```bash
npm install -g zlocalz
```

## Quick Start

### Interactive Setup (Recommended)

Simply run `zlocalz` without any arguments to launch the interactive setup wizard:

```bash
zlocalz
```

The setup wizard will:
- Detect existing localization files automatically
- Guide you through configuration options
- Create `zlocalz.config.json` and `.env` files
- Launch the TUI interface when complete

### Manual Configuration

Alternatively, create a configuration file `zlocalz.config.json` manually:

```json
{
  "flutterLocalesPath": "lib/l10n/",
  "sourceLocale": "en",
  "targetLocales": ["es", "fr", "de"],
  "fileFormat": "auto",
  "autoUpdate": true,
  "doAutoFix": true,
  "translateMissing": true,
  "geminiModel": "gemini-2.5-pro",
  "preferOrder": "mirror-source"
}
```

> **Note**: `autoUpdate` defaults to `true`. Set to `false` to disable automatic updates and receive notifications instead.

### Supported File Formats

**ARB (Application Resource Bundle):**
```
lib/l10n/app_en.arb
lib/l10n/app_es.arb
```

**JSON:**
```
locales/en.json
locales/es.json  
```

**YAML:**
```
i18n/en.yml
i18n/es.yml
```

**CSV (Multi-locale in one file):**
```
translations.csv:
key,en,es,fr
welcome,"Welcome!","¡Bienvenido!","Bienvenue!"
```

2. Set your Gemini API key:

```bash
export GEMINI_API_KEY="your-api-key"
```

3. Launch ZLocalz:

```bash
# Interactive setup (first-time users)
zlocalz

# Auto-detect format and launch TUI
zlocalz scan

# Specify format explicitly  
zlocalz scan --format json
zlocalz scan --format yaml
zlocalz scan --format csv

# Command-line mode
zlocalz scan --no-tui
```

## Setup Wizard Features

The interactive setup wizard (`zlocalz` without arguments) provides:

### 🔍 **Smart Detection**
- Automatically scans common Flutter localization directories (`lib/l10n`, `assets/l10n`, etc.)
- Detects existing file formats (ARB, JSON, YAML, CSV, TSV)
- Suggests optimal configuration based on your project structure

### ⚙️ **Configuration Options**
- **Basic Setup**: Path, format, source/target locales
- **Advanced Options**: Auto-fix settings, key ordering preferences
- **AI Translation**: Optional Google Gemini integration with API key management
- **Format-Specific**: CSV delimiter and column configuration

### 📁 **File Management**
- Creates `zlocalz.config.json` with your preferences
- Securely stores API keys in `.env` file
- Automatically adds `.env` to `.gitignore`
- Validates all inputs with helpful error messages

### 🚀 **Seamless Launch**
- Automatically launches TUI interface after setup
- Shows configuration summary and next steps
- Provides helpful tips for using ZLocalz effectively

## TUI Keybindings

### Navigation
- `←/→` - Focus panes
- `↑/↓` - Move selection
- `Tab` - Cycle panes

### Search & Filter
- `/` - Global search
- `f` - Filter menu
- `*` - Toggle "only issues"

### Actions
- `a` - Auto-fix selected
- `t` - Translate selected
- `d` - View diff
- `e` - Edit value
- `m` - Edit metadata
- `Space` - Select/deselect key
- `A` - Select all visible

### File Operations
- `S` - Save changes
- `P` - Copy patch
- `u` - Undo
- `Ctrl+r` - Redo

### Commands
- `:` - Open command palette
- `?` - Show help
- `q` - Quit

## CLI Commands

### Scan and validate
```bash
zlocalz scan --path lib/l10n --source en --targets es fr
```

### Auto-fix issues
```bash
zlocalz fix
```

### Translate missing keys
```bash
zlocalz translate --key YOUR_GEMINI_API_KEY
```

### Export report
```bash
zlocalz scan --no-tui > report.json
```

### Report an issue from the CLI

```bash
# Open issues page
zlocalz issue

# Open new issue form
zlocalz issue --new
```

## Configuration

### Required Fields
- `flutterLocalesPath`: Path to your Flutter localization files
- `sourceLocale`: The reference locale (e.g., "en")
- `targetLocales`: Array of target locale codes

### Optional Fields
- `doAutoFix`: Enable automatic fixes (default: false)
- `translateMissing`: Enable AI translation (default: false)
- `geminiModel`: Gemini model to use (default: "gemini-2.5-pro")
- `styleGuidelines`: Translation style rules
- `domainGlossary`: Key-value pairs for consistent translations
- `doNotTranslate`: Tokens to preserve (e.g., brand names)
- `preferOrder`: "mirror-source" or "alphabetical"

## Example Workflow

1. **Scan**: Open TUI and review validation issues
2. **Filter**: Use `f` to filter by issue type
3. **Select**: Space to select affected keys
4. **Fix**: Press `a` to auto-fix selected issues
5. **Translate**: Press `t` to translate missing keys
6. **Review**: Use diff view (`d`) to review changes
7. **Save**: Press `S` to write changes to disk

## Output

ZLocalz generates a comprehensive JSON report with:
- Issue summary by type and locale
- Applied fixes with descriptions
- Translation results with safety checks
- Unified diff patches
- Ready-to-commit file contents

## Roadmap

- Fix bugs and improve stability across all supported formats
- TUI visual upgrade: modern themes, layout polish, accessibility, and mouse support
- Add new features based on community feedback (filters, reports, bulk ops)
- First-class Next.js support (integrate with Next.js i18n config and file structures)

## Collaboration

We are open to collaboration and welcome contributions of all sizes. Ways you can help:

- Improve stability by fixing bugs
- Make the TUI look great with better UX, theming, and accessibility
- Add features that make workflows faster and safer
- Implement and refine Next.js support

How to collaborate:

1. Fork the repo: [github.com/bllfoad/zlocalz](https://github.com/bllfoad/zlocalz)
2. Create a branch: `git checkout -b feat/your-feature`
3. Install dependencies: `npm install`
4. Run in dev mode: `npm run dev`
5. Build locally: `npm run build`
6. Lint and test: `npm run lint` and `npm test`
7. Open a Pull Request with a clear description and screenshots when relevant

For discussions, ideas, or questions, please open an issue in the repository.

## License

MIT