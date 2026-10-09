import { App, FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, TFile, moment, parseYaml } from "obsidian";
import { appendBody, fillPlaceholders, findRule, mergeProps, splitFrontmatter, type Rule } from "./template";

// Bases Templates: the New button in a base makes the note from a template chosen for that base, or for
// one view in it. Notes made any other way are left alone.

interface Settings {
  rules: Rule[];
  // Where the template picker looks first. Empty means every note in the vault.
  folder: string;
}

const DEFAULTS: Settings = { rules: [], folder: "Templates" };

// A note made within this many milliseconds of a click or key press inside a base counts as made by it.
const WINDOW = 3000;

interface TemplaterApi {
  write_template_to_file(template: TFile, file: TFile): Promise<void>;
}

export default class BasesTemplatesPlugin extends Plugin {
  settings: Settings = DEFAULTS;
  // The base (and view) the person last clicked or typed in, and when
  private lastBase: { base: string; view: string; at: number } | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BasesTemplatesTab(this.app, this));

    // Which base the person is using. Watched in the capture phase, so it is seen before the base acts on it.
    const note = (evt: Event) => {
      const target = evt.target instanceof Node ? evt.target : null;
      if (!target) return;
      for (const leaf of this.app.workspace.getLeavesOfType("bases")) {
        if (!leaf.view.containerEl.contains(target)) continue;
        // Split groups views make their own notes from their own template, so they are left alone
        if (leaf.view.containerEl.querySelector(".split-groups")) return;
        const state = leaf.getViewState().state as { file?: string; viewName?: string } | undefined;
        if (state?.file) this.lastBase = { base: state.file, view: state.viewName ?? "", at: Date.now() };
        return;
      }
    };
    this.registerDomEvent(activeDocument, "pointerdown", note, { capture: true });
    this.registerDomEvent(activeDocument, "keydown", note, { capture: true });

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.onCreate(file);
      }));
    });

    this.addCommand({
      id: "choose-template-for-view",
      name: "Choose the template for this base view",
      checkCallback: (checking) => {
        const here = this.currentBase();
        if (!here) return false;
        if (!checking) new TemplatePicker(this, here.base, here.view).open();
        return true;
      },
    });
  }

  // The base open in the active tab, and which of its views is showing.
  currentBase(): { base: string; view: string } | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf || leaf.view.getViewType() !== "bases") return null;
    const state = leaf.getViewState().state as { file?: string; viewName?: string } | undefined;
    return state?.file ? { base: state.file, view: state.viewName ?? "" } : null;
  }

  private async onCreate(file: TFile) {
    const from = this.lastBase;
    if (!from || Date.now() - from.at > WINDOW) return;
    const rule = findRule(this.settings.rules, from.base, from.view);
    if (!rule) return;
    // Only a brand new note: anything that already has a body was not made by New
    if (splitFrontmatter(await this.app.vault.read(file)).body.trim()) return;
    const template = this.app.vault.getFileByPath(rule.template);
    if (!template) {
      new Notice(`Bases Templates: the template ${rule.template} was not found.`);
      return;
    }
    this.lastBase = null; // one note per click
    try {
      await this.apply(template, file);
    } catch (err) {
      new Notice(`Bases Templates could not fill in ${file.basename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async apply(template: TFile, file: TFile) {
    const text = await this.app.vault.read(template);
    // Templater syntax goes to Templater when it is installed; the base's own values are put back after.
    const plugins = (this.app as unknown as { plugins: { getPlugin(id: string): unknown } }).plugins;
    const templater = (plugins.getPlugin("templater-obsidian") as { templater?: TemplaterApi } | null)?.templater;
    if (text.includes("<%") && templater?.write_template_to_file) {
      const before = splitFrontmatter(await this.app.vault.read(file)).yaml;
      const kept = before ? (parseYaml(before) as Record<string, unknown>) ?? {} : {};
      await templater.write_template_to_file(template, file);
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        Object.assign(fm, mergeProps(kept, fm));
      });
      return;
    }
    // Typed here so the check holds where moment's own types are not installed
    const now = moment as unknown as () => { format(fmt: string): string };
    const filled = fillPlaceholders(text, file.basename, (fmt) => now().format(fmt));
    const { yaml, body } = splitFrontmatter(filled);
    if (yaml) {
      const props = (parseYaml(yaml) as Record<string, unknown> | null) ?? {};
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        Object.assign(fm, mergeProps(fm, props));
      });
    }
    if (body.trim()) await this.app.vault.process(file, (data) => appendBody(data, body));
  }

  async setRule(base: string, view: string, template: string) {
    const rules = this.settings.rules.filter((r) => !(r.base === base && r.view === view));
    if (template) rules.push({ base, view, template });
    this.settings.rules = rules;
    await this.saveSettings();
  }

  async loadSettings() {
    const saved = ((await this.loadData()) ?? {}) as Partial<Settings>;
    this.settings = {
      rules: Array.isArray(saved.rules) ? saved.rules.filter((r) => r && typeof r.base === "string" && typeof r.template === "string").map((r) => ({ base: r.base, view: typeof r.view === "string" ? r.view : "", template: r.template })) : [],
      folder: typeof saved.folder === "string" ? saved.folder : DEFAULTS.folder,
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Notes to offer as templates: those in the templates folder, or every note if that folder is empty or missing.
  templateFiles(): TFile[] {
    const all = this.app.vault.getMarkdownFiles();
    const folder = this.settings.folder.replace(/\/+$/, "");
    const inFolder = folder ? all.filter((f) => f.path.startsWith(folder + "/")) : [];
    return (inFolder.length ? inFolder : all).sort((a, b) => a.path.localeCompare(b.path));
  }
}

// Picks a template for the base view that is open, from the command palette.
class TemplatePicker extends FuzzySuggestModal<TFile | null> {
  constructor(private plugin: BasesTemplatesPlugin, private base: string, private view: string) {
    super(plugin.app);
    this.setPlaceholder(`Template for New in ${view ? `the "${view}" view of ` : ""}${base}`);
  }

  getItems(): (TFile | null)[] {
    return [null, ...this.plugin.templateFiles()];
  }

  getItemText(item: TFile | null): string {
    return item ? item.path : "No template (a blank note, as before)";
  }

  onChooseItem(item: TFile | null): void {
    void this.plugin.setRule(this.base, this.view, item?.path ?? "").then(() => {
      new Notice(item ? `New in this view now uses ${item.basename}.` : "New in this view makes a blank note again.");
    });
  }
}

class BasesTemplatesTab extends PluginSettingTab {
  constructor(app: App, private plugin: BasesTemplatesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const plugin = this.plugin;

    new Setting(containerEl)
      .setName("Templates folder")
      .setDesc("The template lists show the notes in this folder. Leave it empty to show every note.")
      .addText((t) => t.setValue(plugin.settings.folder).onChange(async (v) => {
        plugin.settings.folder = v.trim();
        await plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Template for each base").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Each line picks the template a base uses when you press its button for a new note. Leave the view empty for every view in that base, and a line for one view wins over that. Quickest way: open the base and run the command to choose the template for this base view.",
    });

    const bases = this.app.vault.getFiles().filter((f) => f.extension === "base").map((f) => f.path).sort();
    const templates = plugin.templateFiles().map((f) => f.path);

    plugin.settings.rules.forEach((rule, i) => {
      const row = new Setting(containerEl);
      row.addDropdown((d) => {
        for (const b of new Set([rule.base, ...bases])) if (b) d.addOption(b, b);
        d.setValue(rule.base).onChange(async (v) => { rule.base = v; await plugin.saveSettings(); });
      });
      row.addText((t) => t.setPlaceholder("Every view").setValue(rule.view).onChange(async (v) => {
        rule.view = v.trim();
        await plugin.saveSettings();
      }));
      row.addDropdown((d) => {
        for (const p of new Set([rule.template, ...templates])) if (p) d.addOption(p, p);
        d.setValue(rule.template).onChange(async (v) => { rule.template = v; await plugin.saveSettings(); });
      });
      row.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
        plugin.settings.rules.splice(i, 1);
        await plugin.saveSettings();
        this.display();
      }));
    });

    new Setting(containerEl).addButton((b) => b.setButtonText("Add a line").onClick(async () => {
      if (!bases.length || !templates.length) {
        new Notice("Add a base and a template note to your vault first.");
        return;
      }
      plugin.settings.rules.push({ base: bases[0], view: "", template: templates[0] });
      await plugin.saveSettings();
      this.display();
    }));
  }
}
