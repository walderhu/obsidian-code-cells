const {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
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
  recentLanguages: [],
};

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
  }
}

class CalcPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor("calc", (source, element, context) => {
      this.renderCalculation(source, element, context);
    });

    this.addCommand({
      id: "insert-fenced-code-block",
      name: "Insert fenced code block",
      editorCallback: (editor) => {
        this.openLanguagePicker(editor);
      },
    });

    this.addSettingTab(new CalcSettingTab(this.app, this));

    this.registerDomEvent(document, "keydown", (event) => {
      this.openLanguagePickerOnHotkey(event);
      this.commitCalculationOnEnter(event);
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

    const editExpression = (event) => {
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
        this.refreshLivePreviewDecorations(view.editor, editLine, lineText);
      });
    };
    resultElement.addEventListener("click", editExpression);
    resultElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        editExpression(event);
      }
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
