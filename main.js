const {
  EditorSuggest,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
} = require("obsidian");

const DEGREE = Math.PI / 180;

const CONSTANTS = {
  e: Math.E,
  pi: Math.PI,
};

const FUNCTIONS = {
  abs: (value) => Math.abs(value),
  acos: (value) => Math.acos(value) / DEGREE,
  asin: (value) => Math.asin(value) / DEGREE,
  atan: (value) => Math.atan(value) / DEGREE,
  cbrt: (value) => Math.cbrt(value),
  ceil: (value) => Math.ceil(value),
  cos: (value) => Math.cos(value * DEGREE),
  exp: (value) => Math.exp(value),
  fact: (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 170) {
      throw new Error("fact() requires an integer from 0 to 170");
    }
    let result = 1;
    for (let factor = 2; factor <= value; factor += 1) {
      result *= factor;
    }
    return result;
  },
  floor: (value) => Math.floor(value),
  lg: (value) => Math.log10(value),
  ln: (value) => Math.log(value),
  log: (value) => Math.log10(value),
  round: (value) => Math.round(value),
  sin: (value) => Math.sin(value * DEGREE),
  sqrt: (value) => Math.sqrt(value),
  tan: (value) => {
    const angle = value * DEGREE;
    if (Math.abs(Math.cos(angle)) < 1e-12) {
      throw new Error("tan() is undefined at this angle");
    }
    return Math.tan(angle);
  },
  trunc: (value) => Math.trunc(value),
};

const CODE_LANGUAGES = [
  { id: "calc" },
  { id: "text" },
  { id: "python" },
  { id: "python run" },
  { id: "bash" },
  { id: "sql" },
  { id: "javascript" },
  { id: "typescript" },
  { id: "json" },
  { id: "html" },
  { id: "css" },
  { id: "markdown" },
  { id: "yaml" },
  { id: "powershell" },
  { id: "c" },
  { id: "cpp" },
  { id: "java" },
  { id: "rust" },
  { id: "go" },
  { id: "latex" },
];

const DEFAULT_SETTINGS = {
  captureCtrlK: true,
  pythonCommand: "local",
  pythonTimeoutSeconds: 5,
  recentLanguages: [],
};

const PYTHON_SUGGESTIONS = [
  "print", "len", "range", "enumerate", "zip", "list", "dict", "set", "tuple",
  "str", "int", "float", "bool", "sum", "min", "max", "sorted", "open", "input",
  "abs", "round", "type", "isinstance", "Exception", "ValueError", "True", "False",
  "None", "def", "class", "return", "import", "from", "as", "for", "while", "if",
  "elif", "else", "try", "except", "finally", "with", "lambda", "yield", "async",
  "await", "break", "continue", "pass", "and", "or", "not", "in", "is",
];

class ExpressionParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    const value = this.parseAdditive();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error(`Unexpected character "${this.source[this.index]}"`);
    }
    return value;
  }

  parseAdditive() {
    let value = this.parseMultiplicative();

    while (true) {
      if (this.take("+")) {
        value += this.parseMultiplicative();
      } else if (this.take("-")) {
        value -= this.parseMultiplicative();
      } else {
        return value;
      }
    }
  }

  parseMultiplicative() {
    let value = this.parsePower();

    while (true) {
      if (this.take("*")) {
        value *= this.parsePower();
      } else if (this.take("/")) {
        const divisor = this.parsePower();
        if (divisor === 0) {
          throw new Error("Division by zero");
        }
        value /= divisor;
      } else if (this.take("%")) {
        const divisor = this.parsePower();
        if (divisor === 0) {
          throw new Error("Division by zero");
        }
        value %= divisor;
      } else {
        return value;
      }
    }
  }

  parsePower() {
    const value = this.parseUnary();
    if (this.take("^")) {
      return value ** this.parsePower();
    }
    return value;
  }

  parseUnary() {
    if (this.take("+")) {
      return this.parseUnary();
    }
    if (this.take("-")) {
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.take("(")) {
      const value = this.parseAdditive();
      if (!this.take(")")) {
        throw new Error("Missing closing parenthesis");
      }
      return value;
    }

    this.skipWhitespace();
    const identifier = this.source.slice(this.index).match(/^[a-z]+/i);
    if (identifier) {
      return this.parseIdentifier(identifier[0].toLowerCase());
    }

    const match = this.source
      .slice(this.index)
      .match(/^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?/i);

    if (!match) {
      throw new Error("Number expected");
    }

    this.index += match[0].length;
    return Number(match[0].replace(",", "."));
  }

  parseIdentifier(name) {
    this.index += name.length;
    if (Object.hasOwn(CONSTANTS, name)) {
      return CONSTANTS[name];
    }

    const fn = FUNCTIONS[name];
    if (!fn) {
      throw new Error(`Unknown function "${name}"`);
    }
    if (!this.take("(")) {
      throw new Error(`Expected "(" after ${name}`);
    }

    const value = this.parseAdditive();
    if (!this.take(")")) {
      throw new Error("Missing closing parenthesis");
    }
    return fn(value);
  }

  take(character) {
    this.skipWhitespace();
    if (this.source[this.index] !== character) {
      return false;
    }
    this.index += 1;
    return true;
  }

  skipWhitespace() {
    while (/\s/.test(this.source[this.index] || "")) {
      this.index += 1;
    }
  }
}

function evaluateExpression(source) {
  const expression = source.trim();
  if (!expression) {
    throw new Error("Expression is empty");
  }

  const result = new ExpressionParser(expression).parse();
  if (!Number.isFinite(result)) {
    throw new Error("Result is not finite");
  }
  return result;
}

function formatResult(value) {
  if (Object.is(value, -0)) {
    return "0";
  }
  return Number(value.toPrecision(14)).toString();
}

function dedentCode(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)[0].length);
  const indentation = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indentation)).join("\n");
}

function findCalcBlock(editor, line) {
  let openingLine = -1;

  for (let current = line; current >= 0; current -= 1) {
    const text = editor.getLine(current);
    if (/^\s*```calc\s*$/i.test(text)) {
      openingLine = current;
      break;
    }
    if (/^\s*```/.test(text)) {
      return null;
    }
  }

  if (openingLine < 0) {
    return null;
  }

  for (let current = openingLine + 1; current < editor.lineCount(); current += 1) {
    if (/^\s*```\s*$/.test(editor.getLine(current))) {
      return line < current ? { openingLine, closingLine: current } : null;
    }
  }

  return null;
}

function findPythonRunBlock(editor, line) {
  let openingLine = -1;

  for (let current = line; current >= 0; current -= 1) {
    const text = editor.getLine(current);
    if (/^\s*```(?:python\s+run|python-run)\s*$/i.test(text)) {
      openingLine = current;
      break;
    }
    if (/^\s*```/.test(text)) {
      return null;
    }
  }

  if (openingLine < 0) {
    return null;
  }

  for (let current = openingLine + 1; current < editor.lineCount(); current += 1) {
    if (/^\s*```\s*$/.test(editor.getLine(current))) {
      return line < current ? { openingLine, closingLine: current } : null;
    }
  }

  return null;
}

function findFencedCodeBlock(editor, line) {
  let openingLine = -1;

  for (let current = line; current >= 0; current -= 1) {
    if (/^\s*(?:```|~~~)/.test(editor.getLine(current))) {
      openingLine = current;
      break;
    }
  }

  if (openingLine < 0) {
    return null;
  }

  const marker = editor.getLine(openingLine).match(/^\s*(```|~~~)/)?.[1];
  if (!marker) {
    return null;
  }

  for (let current = openingLine + 1; current < editor.lineCount(); current += 1) {
    if (new RegExp(`^\\s*${marker}\\s*$`).test(editor.getLine(current))) {
      return line < current ? { openingLine, closingLine: current } : null;
    }
  }

  return null;
}

class PythonSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.scope.register([], "Tab", (event) => {
      this.suggestions.useSelectedItem(event);
      return false;
    });
  }

  onTrigger(cursor, editor) {
    if (!findPythonRunBlock(editor, cursor.line)) {
      return null;
    }
    const beforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    const match = beforeCursor.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    if (!match) {
      return null;
    }
    this.latestContext = {
      start: { line: cursor.line, ch: cursor.ch - match[0].length },
      end: cursor,
      query: match[0],
    };
    return this.latestContext;
  }

  getSuggestions(context) {
    const editor = this.app.workspace.activeEditor?.editor;
    const block = editor && findPythonRunBlock(editor, context.start.line);
    const names = new Set(PYTHON_SUGGESTIONS);
    if (block) {
      for (let line = block.openingLine + 1; line < block.closingLine; line += 1) {
        const text = editor.getLine(line);
        for (const match of text.matchAll(/\b(?:def|class|import|as)\s+([A-Za-z_]\w*)|\b([A-Za-z_]\w*)\s*=/g)) {
          names.add(match[1] || match[2]);
        }
      }
    }
    const query = context.query.toLowerCase();
    return [...names]
      .filter((name) => name.toLowerCase().startsWith(query) && name !== context.query)
      .sort()
      .slice(0, 30);
  }

  renderSuggestion(suggestion, element) {
    element.addClass("obsidian-python-suggestion-item");
    element.createSpan({ cls: "obsidian-python-suggestion-icon", text: "py" });
    element.createSpan({ cls: "obsidian-python-suggestion-label", text: suggestion });
    element.createSpan({ cls: "obsidian-python-suggestion-kind", text: "Python" });
  }

  selectSuggestion(suggestion) {
    const editor = this.app.workspace.activeEditor?.editor;
    if (editor && this.latestContext) {
      editor.replaceRange(suggestion, this.latestContext.start, this.latestContext.end);
    }
  }
}

class CodeLanguageModal extends FuzzySuggestModal {
  constructor(app, plugin, editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.setPlaceholder("Choose code block language...");
  }

  getItems() {
    return this.plugin.getOrderedLanguages();
  }

  getItemText(item) {
    return item.id;
  }

  onChooseItem(item) {
    this.plugin.insertCodeBlock(this.editor, item.id);
  }
}

class CalcSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Insert code block hotkey")
      .setDesc(
        'The "Insert fenced code block" command is also available in Settings -> Hotkeys.'
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.captureCtrlK)
          .setTooltip("Open the language picker directly with Ctrl+K / Cmd+K")
          .onChange(async (value) => {
            this.plugin.settings.captureCtrlK = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Language history")
      .setDesc("Recently selected code languages are shown first in the picker.")
      .addButton((button) => {
        button.setButtonText("Clear history").onClick(async () => {
          this.plugin.settings.recentLanguages = [];
          await this.plugin.saveSettings();
          new Notice("Calc: language history cleared");
        });
      });

    new Setting(containerEl)
      .setName("Python command")
      .setDesc("Executable used by python run blocks. Use local, auto, python3, python, py, or a full path.")
      .addText((text) => {
        text
          .setPlaceholder("local")
          .setValue(this.plugin.settings.pythonCommand)
          .onChange(async (value) => {
            this.plugin.settings.pythonCommand = value.trim() || DEFAULT_SETTINGS.pythonCommand;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Python timeout")
      .setDesc("Maximum running time for a python run block, in seconds.")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.pythonTimeoutSeconds))
          .setValue(String(this.plugin.settings.pythonTimeoutSeconds))
          .onChange(async (value) => {
            const seconds = Number(value);
            if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 60) {
              this.plugin.settings.pythonTimeoutSeconds = seconds;
              await this.plugin.saveSettings();
            }
          });
      });
  }
}

class CalcPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.pythonResults = new Map();
    this.registerEditorSuggest(new PythonSuggest(this));

    this.registerMarkdownCodeBlockProcessor("calc", (source, element, context) => {
      this.renderCalculation(source, element, context);
    });
    this.registerMarkdownCodeBlockProcessor("python-run", (source, element, context) => {
      this.renderPythonRun(source, element, context);
    });
    this.registerMarkdownCodeBlockProcessor("python", (source, element, context) => {
      if (this.isPythonRunBlock(element, context)) {
        this.renderPythonRun(source, element, context);
      } else {
        this.renderPlainPython(source, element);
      }
    });

    this.addCommand({
      id: "insert-fenced-code-block",
      name: "Insert fenced code block",
      editorCallback: (editor) => {
        this.openLanguagePicker(editor);
      },
    });
    this.addCommand({
      id: "run-current-code-cell",
      name: "Leave current code cell",
      editorCheckCallback: (checking, editor) => {
        const block = findFencedCodeBlock(editor, editor.getCursor().line);
        if (!block) {
          return false;
        }
        if (!checking) {
          this.leaveActiveCodeCell(editor);
        }
        return true;
      },
    });

    this.addSettingTab(new CalcSettingTab(this.app, this));

    this.registerDomEvent(document, "keydown", (event) => {
      this.openLanguagePickerOnHotkey(event);
      this.commitCalculationOnEnter(event);
    }, true);
    // Capture before Obsidian's command hotkeys; let unrelated editors continue normally.
    this.registerDomEvent(window, "keydown", (event) => {
      this.captureCodeCellExecutionOnHotkey(event);
    }, true);
  }

  async loadSettings() {
    const stored = await this.loadData();
    const recentLanguages = Array.isArray(stored?.recentLanguages)
      ? stored.recentLanguages.filter((id) => CODE_LANGUAGES.some((language) => language.id === id))
      : [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored, { recentLanguages });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  openLanguagePicker(editor) {
    new CodeLanguageModal(this.app, this, editor).open();
  }

  openLanguagePickerOnHotkey(event) {
    const pressedModK =
      event.key.toLowerCase() === "k" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey;
    if (!this.settings.captureCtrlK || !pressedModK) {
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.containerEl.contains(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    this.openLanguagePicker(view.editor);
  }

  getOrderedLanguages() {
    const recent = this.settings.recentLanguages;
    return [...CODE_LANGUAGES].sort((left, right) => {
      const leftIndex = recent.indexOf(left.id);
      const rightIndex = recent.indexOf(right.id);
      if (leftIndex === -1 && rightIndex === -1) {
        return 0;
      }
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
  }

  async recordLanguage(language) {
    this.settings.recentLanguages = [
      language,
      ...this.settings.recentLanguages.filter((recent) => recent !== language),
    ].slice(0, CODE_LANGUAGES.length);
    await this.saveSettings();
  }

  insertCodeBlock(editor, language) {
    const selection = editor.getSelection();
    const cursor = editor.getCursor("from");
    const content = selection ? `\n${selection}\n` : "\n\n";
    editor.replaceSelection(`\`\`\`${language}${content}\`\`\``);

    if (!selection) {
      editor.setCursor({ line: cursor.line + 1, ch: 0 });
    }

    this.recordLanguage(language);
  }

  renderCalculation(source, element, context) {
    const expression = source.replace(/=\s*$/, "").trim();
    const resultElement = element.createDiv({ cls: "obsidian-calc-result" });
    resultElement.setAttr("title", "Click to edit calc expression");
    resultElement.setAttr("tabindex", "0");

    try {
      resultElement.setText(formatResult(evaluateExpression(expression)));
    } catch (error) {
      resultElement.addClass("obsidian-calc-error");
      resultElement.setText(error.message);
    }

    const editExpression = (event) => this.editRenderedBlock(element, context, event);
    resultElement.addEventListener("click", editExpression);
    resultElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        editExpression(event);
      }
    });
  }

  editRenderedBlock(element, context, event) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const section = context?.getSectionInfo?.(element);
    if (!view || !section || view.file?.path !== context.sourcePath || view.getMode?.() !== "source") {
      return;
    }

    event?.preventDefault();
    event?.stopPropagation();
    window.requestAnimationFrame(() => {
      view.editor.focus();
      const editLine = section.lineStart + 1;
      const lineText = view.editor.getLine(editLine);
      const cursor = { line: editLine, ch: lineText.length };
      view.editor.setCursor(cursor);
      view.editor.scrollIntoView?.({ from: cursor, to: cursor }, true);
      window.requestAnimationFrame(() => {
        this.refreshLivePreviewDecorations(view.editor, editLine, lineText);
      });
    });
  }

  refreshLivePreviewDecorations(editor, line, lineText) {
    if (!lineText) {
      return;
    }

    const cm = editor.cm;
    if (cm?.dispatch && editor.posToOffset) {
      const from = editor.posToOffset({ line, ch: lineText.length - 1 });
      cm.dispatch({
        changes: { from, to: from + 1, insert: lineText.slice(-1) },
      });
      return;
    }

    // Replacing a character with itself triggers Live Preview decorators
    // without changing the note contents.
    editor.replaceRange(
      lineText.slice(-1),
      { line, ch: lineText.length - 1 },
      { line, ch: lineText.length }
    );
  }

  captureCodeCellExecutionOnHotkey(event) {
    const pressedModEnter =
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey;
    if (!pressedModEnter) {
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.containerEl.contains(event.target) || !this.leaveActiveCodeCell(view.editor)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  leaveActiveCodeCell(editor = null) {
    const activeEditor = editor || this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!activeEditor) {
      return false;
    }

    const line = activeEditor.getCursor().line;
    const block = findFencedCodeBlock(activeEditor, line);
    if (!block) {
      return false;
    }

    if (findPythonRunBlock(activeEditor, line)) {
      this.pythonResults.clear();
    }
    this.leaveExecutableBlock(activeEditor, block);
    return true;
  }

  leaveExecutableBlock(editor, block) {
    if (block.closingLine + 1 >= editor.lineCount()) {
      editor.replaceRange(
        "\n",
        { line: block.closingLine, ch: editor.getLine(block.closingLine).length }
      );
    }
    const destination = { line: block.closingLine + 1, ch: 0 };
    editor.focus?.();
    editor.setCursor(destination);
    editor.scrollIntoView?.({ from: destination, to: destination }, true);
  }

  async renderPythonRun(source, element, context) {
    const code = dedentCode(source);
    const container = element.createDiv({ cls: "obsidian-python-run" });
    const codeElement = container.createEl("pre", { cls: "obsidian-python-code" });
    codeElement.createEl("code", { cls: "language-python", text: code });
    codeElement.setAttr("title", "Click to edit Python code");
    codeElement.addEventListener("click", (event) => {
      this.editRenderedBlock(element, context, event);
    });
    const outputElement = container.createEl("pre", { cls: "obsidian-python-output" });
    const diagnosticsElement = container.createDiv({ cls: "obsidian-python-diagnostics" });
    const section = context?.getSectionInfo?.(element);
    const key = `${context?.sourcePath || ""}:${section?.lineStart ?? ""}:${code}`;

    if (!code.trim()) {
      outputElement.setText("No Python code to run.");
      return;
    }

    if (this.pythonResults.has(key)) {
      this.showPythonResult(outputElement, diagnosticsElement, this.pythonResults.get(key));
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const isLivePreview =
      view &&
      view.file?.path === context?.sourcePath &&
      view.getMode?.() === "source";
    if (!isLivePreview) {
      outputElement.setText("Run this block in Live Preview.");
      return;
    }

    outputElement.setText("Running...");
    diagnosticsElement.setText("Linting...");
    const [execution, diagnostics] = await Promise.all([this.runPython(code), this.lintPython(code)]);
    const result = { ...execution, diagnostics };
    this.pythonResults.set(key, result);
    if (outputElement.isConnected) {
      this.showPythonResult(outputElement, diagnosticsElement, result);
    }
  }

  isPythonRunBlock(element, context) {
    const section = context?.getSectionInfo?.(element);
    if (!section) {
      return false;
    }
    const lines = section.text.split("\n");
    const openingLine = lines[section.lineStart] || lines[0] || "";
    return /^\s*```python\s+run\s*$/i.test(openingLine);
  }

  renderPlainPython(source, element) {
    const block = element.createEl("pre");
    block.createEl("code", { cls: "language-python", text: source });
  }

  showPythonResult(element, diagnosticsElement, result) {
    element.toggleClass("obsidian-python-error", !result.ok);
    element.setText(result.output || (result.ok ? "(no output)" : "Python failed."));
    diagnosticsElement.empty();
    if (!result.diagnostics?.length) {
      diagnosticsElement.setText("No lint problems.");
      diagnosticsElement.removeClass("obsidian-python-lint-error");
      return;
    }
    diagnosticsElement.addClass("obsidian-python-lint-error");
    for (const diagnostic of result.diagnostics) {
      diagnosticsElement.createDiv({
        text: `Line ${diagnostic.line}: ${diagnostic.code} ${diagnostic.message}`,
      });
    }
  }

  async runPython(source) {
    if (Platform.isMobile) {
      return { ok: false, output: "python run is available on desktop only." };
    }

    const timeout = (this.settings.pythonTimeoutSeconds || DEFAULT_SETTINGS.pythonTimeoutSeconds) * 1000;
    const candidates = this.getPythonCandidates();

    for (const [index, candidate] of candidates.entries()) {
      const result = await this.executePython(candidate.command, [...candidate.args, "-c", source], timeout);
      if (result.ok || result.errorCode !== "ENOENT" || index === candidates.length - 1) {
        return result;
      }
    }
  }

  getPythonCandidates() {
    const configuredCommand = this.settings.pythonCommand || DEFAULT_SETTINGS.pythonCommand;
    const autoCandidates = Platform.isWin
      ? [{ command: "py", args: ["-3"] }, { command: "python", args: [] }]
      : [{ command: "python3", args: [] }, { command: "python", args: [] }];
    if (configuredCommand === "local") {
      return [{ command: this.getLocalEnvironmentExecutable("python"), args: [] }, ...autoCandidates];
    }
    return configuredCommand === "auto"
      ? Platform.isWin
        ? [{ command: "py", args: ["-3"] }, { command: "python", args: [] }]
        : [{ command: "python3", args: [] }, { command: "python", args: [] }]
      : [{ command: configuredCommand, args: [] }];
  }

  getLocalEnvironmentExecutable(name) {
    const path = require("path");
    const basePath = this.app.vault.adapter.getBasePath();
    const pluginDirectory = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    const directory = Platform.isWin ? "Scripts" : "bin";
    const suffix = Platform.isWin ? ".exe" : "";
    return path.join(basePath, pluginDirectory, ".venv", directory, `${name}${suffix}`);
  }

  async lintPython(source) {
    if (Platform.isMobile) {
      return [];
    }
    const candidates = [
      this.getLocalEnvironmentExecutable("ruff"),
      "ruff",
    ];
    for (const [index, command] of candidates.entries()) {
      const result = await this.executeWithInput(
        command,
        ["check", "--output-format=json", "--stdin-filename", "cell.py", "-"],
        source,
        5000
      );
      if (result.errorCode === "ENOENT" && index < candidates.length - 1) {
        continue;
      }
      try {
        return JSON.parse(result.stdout || "[]").map((problem) => ({
          line: problem.location.row,
          code: problem.code,
          message: problem.message,
        }));
      } catch (_error) {
        return result.ok ? [] : [{ line: 1, code: "ruff", message: result.stderr || result.output }];
      }
    }
    return [];
  }

  async executePython(command, args, timeout) {
    try {
      const { execFile } = require("child_process");
      const result = await new Promise((resolve, reject) => {
        execFile(
          command,
          args,
          { timeout, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              reject({ error, stdout, stderr });
            } else {
              resolve({ stdout, stderr });
            }
          }
        );
      });
      return { ok: true, output: `${result.stdout}${result.stderr}`.trimEnd() };
    } catch (failure) {
      const details = `${failure.stderr || ""}${failure.stdout || ""}`.trimEnd();
      const message = failure.error?.killed
        ? `Execution stopped after ${this.settings.pythonTimeoutSeconds} seconds.`
        : failure.error?.message || "Python failed.";
      return { ok: false, output: details || message, errorCode: failure.error?.code };
    }
  }

  async executeWithInput(command, args, input, timeout) {
    const { spawn } = require("child_process");
    return new Promise((resolve) => {
      const process = spawn(command, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => process.kill(), timeout);
      process.stdout.on("data", (chunk) => { stdout += chunk; });
      process.stderr.on("data", (chunk) => { stderr += chunk; });
      process.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, stdout, stderr, output: error.message, errorCode: error.code });
      });
      process.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout, stderr, output: stderr, errorCode: null });
      });
      process.stdin.end(input);
    });
  }

  commitCalculationOnEnter(event) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.containerEl.contains(event.target)) {
      return;
    }

    const editor = view.editor;
    const cursor = editor.getCursor();
    const block = findCalcBlock(editor, cursor.line);
    if (!block) {
      return;
    }

    const lines = [];
    for (let line = block.openingLine + 1; line <= cursor.line; line += 1) {
      const text = editor.getLine(line);
      lines.push(line === cursor.line ? text.slice(0, cursor.ch) : text);
    }

    const typedText = lines.join("\n").trimEnd();
    if (!typedText.endsWith("=")) {
      return;
    }

    const expression = typedText.slice(0, -1).trim();
    let result;
    try {
      result = formatResult(evaluateExpression(expression));
    } catch (error) {
      new Notice(`Calc: ${error.message}`);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    editor.replaceRange(
      `${result}\n`,
      { line: block.openingLine + 1, ch: 0 },
      { line: block.closingLine, ch: 0 }
    );
    editor.setCursor({ line: block.openingLine + 1, ch: result.length });
  }
}

module.exports = CalcPlugin;
module.exports.evaluateExpression = evaluateExpression;
module.exports.formatResult = formatResult;
module.exports.dedentCode = dedentCode;
module.exports.PythonSuggest = PythonSuggest;
module.exports.findPythonRunBlock = findPythonRunBlock;
module.exports.findFencedCodeBlock = findFencedCodeBlock;
