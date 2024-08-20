import {
	App,
	Component,
	Editor,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

// Remember to rename these classes and interfaces!

type TUkutabsImporterSettings = {
	songTemplate: string;
};

const DEFAULT_SETTINGS: TUkutabsImporterSettings = {
	songTemplate:
		'---\ncssclasses: ["ukutabs-importer-song"]\nurl: "{{URL}}"\n---\n# {{TITLE}}\n\n```ukutabs\n```\n\n{{LYRICS}}',
};

export default class UkutabsImporter extends Plugin {
	settings: TUkutabsImporterSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new UkutabsImporterSettings(this.app, this));

		this.addCommand({
			id: "ukutabs-importer:import-song",
			name: "Ukutabs importer: Import song",
			callback: () => {
				const modal = new ImportSongModal(this.app, this.settings);
				modal.open();
			},
		});

		this.registerMarkdownCodeBlockProcessor(
			"ukutabs",
			async (source, el, ctx) => {
				const file = this.app.vault.getFileByPath(ctx.sourcePath);
				if (!file) {
					// TODO handle this better
					console.error(
						"Could not find file for corresponding codeblock"
					);
					return;
				}
				const info = this.app.metadataCache.getFileCache(file);
				const chordLinks = info?.links
					?.filter((l) => l.link.endsWith(".svg"))
					?.map((l) => l.original);
				const uniqueChordLinks = [...new Set(chordLinks)];
				const embeds =
					uniqueChordLinks?.reduce((acc, cur) => {
						return acc + " !" + cur;
					}, "") ?? "No chords found";
				const cmp = new Component();
				el.empty();
				el.classList.add("ukutabs-importer-chords-codeblock");
				MarkdownRenderer.render(
					this.app,
					embeds,
					el,
					ctx.sourcePath,
					cmp
				);
			}
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class UkutabsImporterSettings extends PluginSettingTab {
	plugin: UkutabsImporter;

	constructor(app: App, plugin: UkutabsImporter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Song template")
			.setDesc(
				"The template to use when importing a song.\nYou can use the following as template literals: TITLE, URL, LYRICS"
			)
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.songTemplate)
					.onChange(async (value) => {
						this.plugin.settings.songTemplate = value;
						await this.plugin.saveSettings();
					})
					.inputEl.setAttribute(
						"style",
						"width: 15rem; height: 15rem;"
					)
			);

		new Setting(containerEl)
			.setName("Reset to default settings")
			.setDesc(
				"Will reset this plugin's settings back to their defaults."
			)
			.addButton((cmp) => {
				cmp.setButtonText("reset")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings = DEFAULT_SETTINGS;
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}
}

class ImportSongModal extends Modal {
	private url: string = "";
	private fileName: string = "";
	private folderPath: string = "/";
	private fileNameError: HTMLLIElement;
	private urlError: HTMLLIElement;
	private settings: TUkutabsImporterSettings;
	constructor(app: App, settings: TUkutabsImporterSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen(): void {
		const { contentEl } = this;
		// containerEl.empty();
		contentEl.createEl("h2", { text: "Import Ukutabs song" });
		const fileNameError = createEl("li", {
			text: "",
			cls: "ukutabs-importer-hidden",
		});
		const urlError = createEl("li", {
			text: "",
			cls: "ukutabs-importer-hidden",
		});
		this.fileNameError = fileNameError;
		this.urlError = urlError;
		const ul = createEl("ul");
		ul.appendChild(fileNameError);
		ul.appendChild(urlError);
		contentEl.appendChild(ul);
		new Setting(contentEl)
			.setName("URL")
			.setDesc("The full URL to the song, including 'https://'.")
			.addText((cmp) => {
				cmp.onChange((v) => (this.url = v));
			});
		new Setting(contentEl)
			.setName("File name")
			.setDesc(
				"The name of the file that is created. Do NOT include the file extension."
			)
			.addText((cmp) => {
				cmp.onChange((v) => (this.fileName = v));
			});
		new Setting(contentEl)
			.setName("Folder path")
			.setDesc("The folder to save the new file to.")
			.addDropdown((cmp) => {
				const folders = this.app.vault.getAllFolders(true);
				const obj = folders.reduce((acc, cur) => {
					const folder = cur.path;
					acc[folder] = folder;
					return acc;
				}, {} as Record<string, string>);
				cmp.addOptions(obj);
				cmp.setValue("/");
				cmp.onChange((v) => (this.folderPath = v));
			});

		new Setting(contentEl).addButton((cmp) => {
			cmp.setButtonText("import");
			cmp.onClick(async () => {
				const isDup = this.isDuplicateFile();
				const isUkuUrl = this.isUkutabURL();
				if (isDup) {
					this.fileNameError.setText(
						"File of this name already exists in this folder!"
					);
					this.fileNameError.setAttribute(
						"class",
						"ukutabs-importer-text-error"
					);
				} else {
					this.fileNameError.setText("");
					this.fileNameError.setAttribute(
						"class",
						"ukutabs-importer-hidden"
					);
				}
				if (!isUkuUrl) {
					this.urlError.setText(
						"This is not a valid Ukutabs.com URL!"
					);
					this.urlError.setAttribute(
						"class",
						"ukutabs-importer-text-error"
					);
				} else {
					this.urlError.setText("");
					this.urlError.setAttribute(
						"class",
						"ukutabs-importer-hidden"
					);
				}
				if (isDup || !isUkuUrl) return;
				await this.importSong();
				this.close();
			});
		});

		// new Setting(containerEl).setN
	}

	getFilePath(): string {
		const { fileName, folderPath } = this;
		const fp = folderPath === "/" ? "" : folderPath + "/";
		const path = fp + fileName + ".md";
		return path;
	}

	isDuplicateFile(): boolean {
		const path = this.getFilePath();
		const file = this.app.vault.getFileByPath(path);
		if (file) return true;
		return false;
	}

	isUkutabURL(): boolean {
		return this.url.startsWith("https://ukutabs.com/");
	}

	async importSong(): Promise<void> {
		const res = await fetch(this.url);
		const text = await res.text();
		const parser = new DOMParser();
		const doc = parser.parseFromString(text, "text/html");
		const content = doc.getElementById("ukutabs-song");
		if (!content) {
			// TODO handle this better
			throw new Error(
				"Could not find element which contains lyrics and chords"
			);
		}
		const { children } = content;
		if (!children) {
			// TODO handle this better
			throw new Error(
				"Content appears to empty... this should never happen"
			);
		}
		Array.from(children).forEach((el, index) => {
			const tag = el.tagName.toLowerCase();
			const chord = el.textContent;
			if (tag === "a") {
				el.outerHTML = "[[" + chord + ".svg|" + chord + "]]";
			}
		});

		let noteContent = this.settings.songTemplate;
		noteContent = noteContent.replaceAll("{{TITLE}}", this.fileName);
		noteContent = noteContent.replaceAll("{{LYRICS}}", content.innerHTML);
		noteContent = noteContent.replaceAll("{{URL}}", this.url);

		const file = await this.app.vault.create(
			this.getFilePath(),
			noteContent
		);
	}
}
