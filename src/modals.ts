import { App, Modal, Setting } from "obsidian";
import { captureSourceFromDrop, normalizeCaptureSource } from "./omnibox-utils";

export class CaptureModal extends Modal {
  private source = "";
  private tags = "";
  private polish: boolean;
  private suggest: boolean;
  private sourceInput?: HTMLInputElement;
  private dropZone?: HTMLElement;

  constructor(
    app: App,
    private readonly initialSource: string,
    initialPolish: boolean,
    private readonly polishModel: string,
    initialSuggest: boolean,
    private readonly onPolishChange: (enabled: boolean) => Promise<void>,
    private readonly onSuggestChange: (enabled: boolean) => Promise<void>,
    private readonly onCapture: (source: string, tags: string[], polish: boolean, suggest: boolean) => Promise<void>,
  ) {
    super(app);
    this.polish = initialPolish;
    this.suggest = initialSuggest;
    this.source = normalizeCaptureSource(initialSource);
  }

  onOpen(): void {
    this.titleEl.setText("Capture URL or file with OMD");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Paste a URL or local file path. OMD converts it into recoverable Markdown inside this vault.",
    });
    new Setting(this.contentEl)
      .setName("URL or file")
      .setDesc("For example: https://… or /Users/…/document.pdf")
      .addText((text) => {
        text.inputEl.addClass("omd-capture-source");
        text.setPlaceholder("Example URL or file path")
          .setValue(this.source)
          .onChange((value) => { this.source = normalizeCaptureSource(value); });
        this.sourceInput = text.inputEl;
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    this.dropZone = this.contentEl.createDiv({ cls: "omd-capture-dropzone" });
    this.dropZone.createEl("strong", { text: "Drop a local file here" });
    this.dropZone.createSpan({ text: "The path is filled in without invoking a shell." });
    this.bindDropTarget(this.dropZone);
    new Setting(this.contentEl)
      .setName("Tags")
      .setDesc("Optional comma-separated Obsidian tags. Nested tags such as project/research are supported.")
      .addText((text) => text.setPlaceholder("Example: inbox, research/calendar").onChange((value) => { this.tags = value; }));
    new Setting(this.contentEl)
      .setName("Polish with local AI")
      .setDesc(`Optional. Runs ${this.polishModel} after fast structural cleanup. Long pages can take several minutes.`)
      .addToggle((toggle) => toggle.setValue(this.polish).onChange(async (value) => {
        this.polish = value;
        await this.onPolishChange(value);
      }));
    new Setting(this.contentEl)
      .setName("Suggest links and tags after capture")
      .setDesc("Open a local, review-first proposal after capture. Nothing is written until you confirm it.")
      .addToggle((toggle) => toggle.setValue(this.suggest).onChange(async (value) => {
        this.suggest = value;
        await this.onSuggestChange(value);
      }));
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText("Capture").onClick(async () => {
        if (!this.source) return;
        const tags = this.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
        this.close();
        await this.onCapture(this.source, tags, this.polish, this.suggest);
      }));
  }

  onClose(): void { this.contentEl.empty(); }

  private bindDropTarget(target: HTMLElement): void {
    const setActive = (active: boolean) => target.toggleClass("is-drop-target", active);
    target.addEventListener("dragenter", (event) => {
      event.preventDefault();
      setActive(true);
    });
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      setActive(true);
    });
    target.addEventListener("dragleave", (event) => {
      if (event.currentTarget === event.target) setActive(false);
    });
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      setActive(false);
      const source = captureSourceFromDataTransfer(event.dataTransfer);
      if (!source) return;
      this.source = source;
      if (this.sourceInput) this.sourceInput.value = this.source;
    });
  }
}

function captureSourceFromDataTransfer(dataTransfer: DataTransfer | null): string {
  const file = dataTransfer?.files?.[0];
  const filePath = file && "path" in file && typeof file.path === "string" ? file.path : "";
  return captureSourceFromDrop(
    filePath,
    dataTransfer?.getData("text/uri-list") ?? "",
    dataTransfer?.getData("text/plain") ?? "",
  );
}
