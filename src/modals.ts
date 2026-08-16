import { App, Modal, Setting } from "obsidian";
import type { AiPreview } from "./omd-bridge";

export class CaptureModal extends Modal {
  private source = "";
  private tags = "";
  private polish: boolean;

  constructor(
    app: App,
    initialPolish: boolean,
    private readonly polishModel: string,
    private readonly onPolishChange: (enabled: boolean) => Promise<void>,
    private readonly onCapture: (source: string, tags: string[], polish: boolean) => Promise<void>,
  ) {
    super(app);
    this.polish = initialPolish;
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
        text.setPlaceholder("Example URL or file path").onChange((value) => { this.source = value.trim(); });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
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
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText("Capture").onClick(async () => {
        if (!this.source) return;
        const tags = this.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
        this.close();
        await this.onCapture(this.source, tags, this.polish);
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly body: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.body });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText(this.confirmLabel).onClick(async () => {
        this.close();
        await this.onConfirm();
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}

export class AiConsentModal extends Modal {
  constructor(app: App, private readonly value: AiPreview, private readonly onConfirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    const { preview, evidence } = this.value;
    this.titleEl.setText("Cloud for this task");
    this.contentEl.createEl("p", {
      text: `${preview.provider} / ${preview.model} at ${preview.destination_domain}. ${preview.estimated_input_tokens} estimated input tokens.`,
    });
    this.contentEl.createEl("p", { text: preview.data_handling_summary });
    this.contentEl.createEl("p", { text: "Selected vault evidence:" });
    const list = this.contentEl.createEl("ul", { cls: "omd-consent-evidence" });
    for (const hit of evidence) list.createEl("li", { text: `${hit.path}: ${hit.evidence}` });
    if (preview.policy_url) {
      this.contentEl.createEl("a", { text: "Current provider policy", href: preview.policy_url, attr: { target: "_blank", rel: "noopener" } });
    }
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText("Send this context").onClick(async () => {
        this.close();
        await this.onConfirm();
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}
