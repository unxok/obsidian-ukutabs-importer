import {
	App,
	ButtonComponent,
	Component,
	Editor,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	parseYaml,
	Plugin,
	PluginSettingTab,
	Setting,
	stringifyYaml,
	TFile,
} from "obsidian";

type TUkutabsImporterSettings = {
	songTemplate: string;
};

const defaultUkutabsCodeBlockConfig = {
	title: "Uku toolbar",
	callout: "note",
	chords: true,
	chordsCallout: "info",
	autoscroll: true,
	autoscrollCallout: "abstract",
	autoscrollSpeed: 1,
};

const defaultUkutabsCodeBlockConfigStr = stringifyYaml(
	defaultUkutabsCodeBlockConfig
).trim();

const DEFAULT_SETTINGS: TUkutabsImporterSettings = {
	// songTemplate:
	// 	'---\ncssclasses: ["ukutabs-importer-song"]\nurl: "{{URL}}"\ntags: ["{{ARTIST}}"]\n---\n# {{TITLE}}\n\n```ukutabs\nchords: true\nchordsCallout: info\n```\n\n{{LYRICS}}',
	songTemplate: `---\ncssclasses: ["ukutabs-importer-song"]\nurl: "{{URL}}"\ntags: ["{{ARTIST}}"]\n---\n# {{TITLE}}\n\n\`\`\`ukutabs\n${defaultUkutabsCodeBlockConfigStr}\n\`\`\`\n\n{{LYRICS}}`,
};

export default class UkutabsImporter extends Plugin {
	settings: TUkutabsImporterSettings;
	autoscrollId: number | null = null;
	autoscrollSpeed: number = 1;

	async onload() {
		await this.loadSettings();
		// TODO remove in prod
		cleanupLivePreview();

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
			"ukutabs-autoscroller",
			async (source, el, ctx) => {
				const parsedConfig = parseYaml(source) ?? {};
				const defaultConfig = {
					speed: 1,
				};
				const config = {
					...defaultConfig,
					...parsedConfig,
				} as typeof defaultConfig;
				this.autoscrollSpeed = config.speed;
				el.empty();
				el.classList.add(
					"ukutabs-importer-autoscroller-main-container"
				);
				const presetsContainer = el.createDiv({
					cls: "ukutabs-importer-autoscroller-container",
				});
				const createPreset = (speed: number) => {
					const presetButton = presetsContainer.createEl("button", {
						text: speed.toString(),
						cls:
							config.speed === speed
								? "mod-destructive"
								: "mod-cta",
					});
					presetButton.addEventListener("click", () => {
						this.autoscrollSpeed = speed;
						const buttons = presetsContainer.findAll("button");
						buttons.forEach((btn) => {
							btn.className = "mod-cta";
						});
						presetButton.className = "mod-destructive";
					});
				};
				[1, 2, 3, 4, 5].forEach((s) => createPreset(s));
				const container = el.createDiv({
					cls: "ukutabs-importer-autoscroller-container",
				});
				container.createEl("label", {
					text: "Custom speed",
					attr: { for: "autoscroller-input" },
				});

				container
					.createEl("input", {
						attr: {
							type: "number",
							id: "autoscroller-input",
							name: "autoscroller-input",
							min: -3,
							max: 3,
						},
					})
					.addEventListener("input", (e) => {
						const target = e.target as
							| undefined
							| (EventTarget & HTMLInputElement);
						const num = Number(target?.value);
						if (Number.isNaN(num)) {
							return (this.autoscrollSpeed = 0);
						}
						this.autoscrollSpeed = num;
					});

				el.createEl("button", {
					text: "start/stop",
					cls: "mod-cta",
				}).addEventListener("click", () => {
					const { autoscrollId, autoscrollSpeed } = this;
					// if not scrolling
					if (autoscrollId === null) {
						this.autoscrollId = this.registerInterval(
							window.setInterval(() => {
								const editor =
									this.app.workspace.activeEditor?.editor;
								if (!editor) return;
								const { left, top } = editor.getScrollInfo();
								editor.scrollTo(left, top + autoscrollSpeed);
								const { left: newLeft, top: newTop } =
									editor.getScrollInfo();
								if (top === newTop) {
									// reached end
									window.clearInterval(
										this.autoscrollId ?? undefined
									);
									this.autoscrollId = null;
								}
							}, 50)
						);
						return;
					}
					// if scrolling
					window.clearInterval(autoscrollId);
					this.autoscrollId = null;
				});
			}
		);

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
				const defaultConfig = { ...defaultUkutabsCodeBlockConfig };
				const preConfig =
					(parseYaml(source) as Record<string, unknown> | null) ?? {};
				// TODO make a property type
				const config = { ...defaultConfig, ...preConfig };
				console.log("config: ", config);

				let content =
					"> [!" + config.callout + "]+ " + config.title + "\n";
				if (config.chords) {
					const info = this.app.metadataCache.getFileCache(file);
					const chordLinks = info?.links
						?.filter((l) => l.link.endsWith(".svg"))
						?.map((l) => l.original);
					const uniqueChordLinks = [...new Set(chordLinks)];
					const embeds =
						uniqueChordLinks?.reduce((acc, cur) => {
							return acc + " !" + cur;
						}, "") ?? "No chords found";
					const chordsCallout =
						">> [!" +
						config.chordsCallout +
						"]+ Chords\n>> " +
						embeds;
					content += chordsCallout;
				}
				if (config.autoscroll) {
					const callout =
						"\n>\n>> [!" +
						config.autoscrollCallout +
						"]+ Autoscroll\n>> ```ukutabs-autoscroller\n>> speed: " +
						config.autoscrollSpeed +
						"\n>> ```";
					content += callout;
				}
				const cmp = new Component();
				el.empty();
				el.classList.add("ukutabs-importer-chords-codeblock");
				await MarkdownRenderer.render(
					this.app,
					content,
					el,
					ctx.sourcePath,
					cmp
				);
				setImmediate(() => {
					const inp = el.find("input[data-autoscroller-input]");
					if (!inp) {
						console.log("input not found");
						return;
					}
					inp.addEventListener("change", (e) => {
						const target = e.target as
							| undefined
							| (EventTarget & HTMLInputElement);

						console.log("changed: ", target?.value);
					});
				});
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
	private html: string = "";
	private fileName: string = "";
	private folderPath: string = "/";
	// private fileNameError: HTMLLIElement;
	// private urlError: HTMLLIElement;
	private settings: TUkutabsImporterSettings;
	private importFromURL: boolean = true;
	private errors: Array<keyof typeof ImporterErrors> = [];

	constructor(app: App, settings: TUkutabsImporterSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen(): void {
		const { contentEl } = this;
		// containerEl.empty();
		contentEl.createEl("h2", { text: "Import Ukutabs song" });
		const errorUl = createEl("ul");
		contentEl.appendChild(errorUl);

		const radioContainer = createDiv({
			cls: "ukutabs-importer-radio-container",
		});
		const urlRadioDiv = createDiv();
		const urlRadioInput = urlRadioDiv.createEl("input", {
			type: "radio",
			attr: {
				name: "importOption",
				id: "importOptionURL",
				checked: "true",
			},
		});
		urlRadioDiv.createEl("label", {
			attr: { for: "importOptionURL" },
			text: "URL",
		});
		const htmlRadioDiv = createDiv();
		const htmlRadioInput = htmlRadioDiv.createEl("input", {
			type: "radio",
			attr: { name: "importOption", id: "importOptionHTML" },
		});
		htmlRadioDiv.createEl("label", {
			attr: { for: "importOptionHTML" },
			text: "HTML",
		});

		radioContainer.appendChild(urlRadioDiv);
		radioContainer.appendChild(htmlRadioDiv);
		contentEl.appendChild(radioContainer);

		const urlSetting = new Setting(contentEl)
			.setName("URL")
			.setDesc("The full URL to the song, including 'https://'.")
			.addText((cmp) => {
				cmp.setPlaceholder("https://ukutabs.com/...");
				cmp.onChange((v) => (this.url = v));
			});
		const htmlSetting = new Setting(contentEl)
			.setName("HTML")
			.setDesc(
				"The full HTML source code from the song on Ukutabs. Hover over the 'HTML' title for instructions. "
			)
			.addTextArea((cmp) => {
				cmp.setPlaceholder("<!doctype html><html...");
				cmp.onChange((v) => (this.html = v));
				cmp.inputEl.style.width = "15rem";
				cmp.inputEl.style.height = "10rem";
			})
			.setTooltip(
				'Right click on the site > Press option most similar to "view page source" > (new tab opens) press `Ctrl + A` to select all text > press `Ctrl + C` to copy the HTML '
			);
		htmlSetting.settingEl.style.display = "none";

		urlRadioInput.addEventListener("click", (e) => {
			const target = e.currentTarget as
				| undefined
				| (EventTarget & HTMLInputElement);
			if (target?.value !== "on") return;
			this.importFromURL = true;
			urlSetting.settingEl.style.display = "flex";
			htmlSetting.settingEl.style.display = "none";
		});
		htmlRadioInput.addEventListener("click", (e) => {
			const target = e.currentTarget as
				| undefined
				| (EventTarget & HTMLInputElement);
			if (target?.value !== "on") return;
			this.importFromURL = false;
			htmlSetting.settingEl.style.display = "flex";
			urlSetting.settingEl.style.display = "none";
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

		const buttonCallback = (
			cmp: ButtonComponent,
			text: string,
			openFile: boolean
		) => {
			cmp.setButtonText(text);
			cmp.onClick(async () => {
				this.validateInputs();
				if (this.errors.length) {
					setErrors(errorUl, this.errors);
					return;
				}
				const file = await this.importSong(() => this.close());
				if (!file || !openFile) return;
				const sourcepath =
					this.app.workspace.activeEditor?.file?.path ?? "";
				this.app.metadataCache.trigger("");
				// My custom codeblock needs to search it's own file's metadata to render chords in the song, so this waits until that metadata has been cached to open the note
				const doOpen = () => {
					this.app.workspace.openLinkText(file.path, sourcepath);
					this.app.metadataCache.off("finished", doOpen);
				};
				// @ts-expect-error Private API
				this.app.metadataCache.on("finished", doOpen);
			});
		};
		new Setting(contentEl)
			.addButton((cmp) => buttonCallback(cmp, "import", false))
			.addButton((cmp) => buttonCallback(cmp, "import and open", true));

		// new Setting(containerEl).setN
	}

	getFilePath(): string {
		const { fileName, folderPath } = this;
		const fp = folderPath === "/" ? "" : folderPath + "/";
		const path = fp + fileName + ".md";
		return path;
	}

	validateInputs(): void {
		this.errors = [];
		this.isDuplicateFile();
		this.isValidFileName();
		if (!this.fileName) this.errors.push("noName");
		if (this.importFromURL) {
			this.isUkutabURL();
		} else {
			this.isHTMLText();
		}
	}

	isDuplicateFile(): void {
		if (!this.fileName) return;
		const path = this.getFilePath();
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		console.log("got dup: ", path, file);
		this.errors.push("duplicate");
	}

	isValidFileName(): void {
		const { fileName } = this;
		const chars = [
			"*",
			'"',
			"\\",
			"/",
			"<",
			">",
			":",
			"|",
			"?",
			"#",
			"^",
			"[",
			"]",
		];
		const isValid = chars.every((char) => !fileName.includes(char));
		if (isValid) return;
		this.errors.push("invalidName");
	}

	isHTMLText(): void {
		const isHTML = this.html.trim().startsWith("<!doctype html>");
		if (isHTML) return;
		this.errors.push("html");
	}

	isUkutabURL(): void {
		const isURL = this.url.startsWith("https://ukutabs.com/");
		if (isURL) return;
		this.errors.push("url");
	}

	async importSong(closeFn: () => void): Promise<void | TFile> {
		const showNotice = () => {
			new Notice("Something went wrong... Did you typo the URL or HTML?");
		};
		let text = "";
		if (this.importFromURL) {
			try {
				const res = await fetch(this.url);
				if (!res.ok) return showNotice();
				text = await res.text();
			} catch (e) {
				showNotice();
				return;
			}
		} else {
			text = this.html;
		}
		const parser = new DOMParser();
		const doc = parser.parseFromString(text, "text/html");
		console.log("got doc: ", doc);
		const content = doc.getElementById("ukutabs-song");
		if (!content) {
			return showNotice();
		}
		const { children } = content;
		if (!children) {
			return showNotice();
		}
		Array.from(children).forEach((el, index) => {
			const tag = el.tagName.toLowerCase();
			const chord = el.textContent;
			if (tag === "a") {
				el.outerHTML = "[[" + chord + ".svg|" + chord + "]]";
			}
		});

		const artist =
			doc.querySelector(".breadcrumbs-item:nth-child(3) > a > span")
				?.textContent ?? "";

		let noteContent = this.settings.songTemplate;
		noteContent = noteContent.replaceAll("{{TITLE}}", this.fileName);
		noteContent = noteContent.replaceAll("{{LYRICS}}", content.innerHTML);
		noteContent = noteContent.replaceAll("{{URL}}", this.url);
		noteContent = noteContent.replaceAll("{{ARTIST}}", artist);

		try {
			const file = await this.app.vault.create(
				this.getFilePath(),
				noteContent
			);
			closeFn();
			return file;
		} catch (e) {
			if (e instanceof Error) {
				new Notice(e.message);
				return;
			}
			showNotice();
		}
	}
}

/**
 * Dev only function to make hot reload rerender codeblocks
 */
const cleanupLivePreview = () => {
	try {
		// @ts-ignore
		app.workspace.activeEditor.leaf.rebuildView();
		// app.workspace.activeEditor.leaf.view.currentMode.cleanupLivePreview();
	} catch (e) {
		console.log("failed to cleanup live preview");
	}
};

const ImporterErrors = {
	url: "This is not a valid Ukutabs.com URL!",
	html: "This is not valid HTML source code!",
	duplicate: "This file name already exists in the specified folder!",
	noName: "You must specifiy a file name!",
	invalidName: `Invalid file name! Do not use the following characters: '*', '"', '\\', '/', '<', '>', ':', '|', '?', '#', '^', '[', ']'`,
	noLyricsContent:
		"Could not locate lyrics and chords. Are you sure your URL or HTML is for Ukutabs.com?",
} as const;

const setErrors = (
	ulEl: HTMLUListElement,
	errors: Array<keyof typeof ImporterErrors>
) => {
	while (ulEl.hasChildNodes()) {
		ulEl.removeChild(ulEl.lastChild!);
		// ulEl.empty();
	}
	errors.forEach((err) => {
		const li = createEl("li", {
			text: ImporterErrors[err],
			cls: "ukutabs-importer-text-error",
		});
		ulEl.appendChild(li);
	});
};
