import { ItemView, Modal, Notice, Setting, WorkspaceLeaf, type App } from "obsidian";
import { Calendar, type DateSelectInfo, type EventChangeInfo, type EventClickInfo, type EventDisplayInfo } from "fullcalendar";
import dayGridPlugin from "fullcalendar/daygrid";
import timeGridPlugin from "fullcalendar/timegrid";
import listPlugin from "fullcalendar/list";
import interactionPlugin from "fullcalendar/interaction";
import classicThemePlugin from "fullcalendar/themes/classic";
import type OmdHomePlugin from "./main";
import type { CalendarEventRecord, EventSource, ExternalCalendarDescriptor } from "./model";

export const CALENDAR_VIEW_TYPE = "omd-home-calendar";

interface CalendarEventContentArg {
  event: {
    title: string;
    extendedProps: Record<string, unknown>;
  };
  timeText: string;
  view: {
    type: string;
  };
}

export class OmdCalendarView extends ItemView {
  private calendar?: Calendar;
  private readonly plugin: OmdHomePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: OmdHomePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return CALENDAR_VIEW_TYPE; }
  getDisplayText(): string { return "OMD calendar"; }
  getIcon(): string { return "calendar-days"; }

  async onOpen(): Promise<void> {
    await this.plugin.refreshCalendarEvents();
    this.render();
  }
  async onClose(): Promise<void> { this.calendar?.destroy(); }

  render(): void {
    this.calendar?.destroy();
    this.contentEl.empty();
    this.contentEl.addClass("omd-calendar-view");
    const shell = this.contentEl.createDiv({ cls: "omd-calendar-shell" });
    const topbar = shell.createDiv({ cls: "omd-calendar-topbar" });
    const legend = topbar.createDiv({ cls: "omd-calendar-legend" });
    legendItem(legend, "vault", "Vault");
    legendItem(legend, "external", "Calendar");
    legendItem(legend, "linked", "Linked");
    const sync = topbar.createEl("button", { cls: "omd-action-button", type: "button", text: "Sync" });
    sync.addEventListener("click", () => void this.syncEvents());
    const create = topbar.createEl("button", { cls: "mod-cta omd-action-button", type: "button", text: "+ new event" });
    create.addEventListener("click", () => this.createEvent());
    const host = shell.createDiv({ cls: "omd-calendar-host" });
    this.calendar = new Calendar(host, {
      plugins: [classicThemePlugin, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
      initialView: "dayGridMonth",
      colorScheme: document.body.classList.contains("theme-dark") ? "dark" : "light",
      firstDay: 1,
      nowIndicator: true,
      selectable: true,
      editable: true,
      dayMaxEventRows: 3,
      expandRows: true,
      displayEventEnd: false,
      height: "100%",
      headerToolbar: {
        start: "prev,next today",
        center: "title",
        end: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
      },
      events: this.plugin.calendarEvents.map(toFullCalendarEvent),
      select: (selection) => this.createFromSelection(selection),
      eventClick: (info) => this.openEvent(info),
      eventChange: (info) => void this.commitChange(info),
      eventContent: (info: CalendarEventContentArg) => {
        const content = createSpan();
        const monthView = info.view.type === "dayGridMonth";
        content.className = `omd-calendar-event-content${monthView ? " is-month-view" : ""}`;
        content.title = info.event.title;
        if (info.timeText) {
          const time = content.createSpan({ cls: "omd-calendar-event-time", text: info.timeText });
          time.setAttribute("aria-hidden", "true");
        }
        content.createSpan({ cls: "omd-calendar-event-title", text: info.event.title });
        if (!monthView) {
          const statusLabel = calendarStatusLabel(info.event.extendedProps.syncState as string | undefined);
          if (statusLabel) content.createSpan({ cls: "omd-calendar-event-status", text: ` • ${statusLabel}` });
        }
        return { domNodes: [content] };
      },
      eventClass: ({ event }: EventDisplayInfo) => [
        `omd-fc-source-${String(event.extendedProps.source)}`,
        statusClass(event.extendedProps.syncState as string | undefined),
      ].filter(Boolean).join(" "),
    });
    this.calendar.render();
  }

  createEvent(): void {
    const start = new Date();
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    this.openEditor({
      id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
      title: "",
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      calendar: "Vault",
      source: "vault",
      syncState: "clean",
    });
  }

  private createFromSelection(selection: DateSelectInfo): void {
    this.openEditor({
      id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
      title: "",
      start: selection.startStr,
      end: selection.endStr || selection.startStr,
      allDay: selection.allDay,
      calendar: "Vault",
      source: "vault",
      syncState: "clean",
    });
  }

  private openEditor(event: CalendarEventRecord): void {
    const defaultCalendar = resolveWritableDefaultCalendar(this.plugin.externalCalendars, this.plugin.settings);
    new EventEditorModal(this.app, event, defaultCalendar, async (saved) => {
      await this.plugin.saveCalendarEvent(saved);
      this.render();
    }, calendarEditorActions(this.plugin)).open();
  }

  private openEvent(info: EventClickInfo): void {
    const record = this.plugin.calendarEvents.find((event) => event.id === info.event.id);
    if (!record) return;
    if (requiresSyncBeforeEdit(record)) {
      new SyncRequiredModal(this.app, record, async () => {
        await this.plugin.synchronizeCalendarEvents();
        this.render();
      }).open();
      return;
    }
    if (record.syncState === "conflict" && record.conflictExternal) {
      new EventConflictModal(this.app, record, async (choice) => {
        await this.plugin.resolveCalendarConflict(record, choice);
        this.render();
      }).open();
      return;
    }
    const defaultCalendar = resolveWritableDefaultCalendar(this.plugin.externalCalendars, this.plugin.settings);
    new EventEditorModal(this.app, record, defaultCalendar, async (event) => {
      await this.plugin.saveCalendarEvent(event);
      this.render();
    }, calendarEditorActions(this.plugin)).open();
  }

  private async commitChange(info: EventChangeInfo): Promise<void> {
    const existing = this.plugin.calendarEvents.find((event) => event.id === info.event.id);
    if (!existing) return info.revert();
    const start = info.event.start?.toISOString() ?? existing.start;
    const end = info.event.end?.toISOString() ?? info.event.start?.toISOString() ?? existing.end;
    const validationError = validateCalendarEventRange(start, end);
    if (validationError) {
      info.revert();
      new Notice(validationError);
      return;
    }
    try {
      await this.plugin.saveCalendarEvent({
        ...existing,
        start,
        end,
        allDay: info.event.allDay,
      });
    } catch (error) {
      info.revert();
      new Notice(error instanceof Error ? error.message : "Could not update event");
    }
  }

  private async syncEvents(): Promise<void> {
    const plugin = this.plugin as OmdHomePlugin & CalendarViewPluginActions;
    try {
      if (plugin.synchronizeCalendarEvents) await plugin.synchronizeCalendarEvents();
      else await this.plugin.refreshCalendarEvents();
      this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not sync calendars");
    }
  }
}

class EventConflictModal extends Modal {
  private readonly event: CalendarEventRecord;
  private readonly onResolve: (choice: "vault" | "external") => Promise<void>;

  constructor(
    app: App,
    event: CalendarEventRecord,
    onResolve: (choice: "vault" | "external") => Promise<void>,
  ) {
    super(app);
    this.event = event;
    this.onResolve = onResolve;
  }

  onOpen(): void {
    this.titleEl.setText("Calendar conflict");
    this.contentEl.createEl("p", { text: `“${this.event.title}” changed in both its note and Calendar.` });
    this.contentEl.createEl("p", { cls: "omd-conflict-help", text: "Choose which version should become the linked event. Nothing is overwritten until you choose." });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Keep note").onClick(async () => this.resolve("vault")))
      .addButton((button) => button.setCta().setButtonText("Keep calendar").onClick(async () => this.resolve("external")));
  }

  onClose(): void { this.contentEl.empty(); }

  private async resolve(choice: "vault" | "external"): Promise<void> {
    try {
      await this.onResolve(choice);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not resolve Calendar conflict");
    }
  }
}

class SyncRequiredModal extends Modal {
  constructor(
    app: App,
    private readonly event: CalendarEventRecord,
    private readonly onSync: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const failed = this.event.syncState === "error";
    this.titleEl.setText(failed ? "Calendar sync paused" : "Calendar has newer changes");
    this.contentEl.createEl("p", {
      text: failed
        ? "OMD Home could not safely read Calendar. Retry before editing, recreating, or deleting this linked event."
        : "Import the newer Calendar version before editing this linked note, so the external change is not overwritten.",
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText(failed ? "Retry sync" : "Import Calendar change").onClick(async () => {
        try {
          await this.onSync();
          this.close();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "Could not sync Calendar");
        }
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}

class EventEditorModal extends Modal {
  private draft: CalendarEventRecord;
  private readonly defaultCalendar: WritableDefaultCalendar | null;
  private readonly onSave: (event: CalendarEventRecord) => Promise<void>;
  private readonly actions: CalendarEditorActions;
  private readonly initialSource: EventSource;

  constructor(
    app: App,
    event: CalendarEventRecord,
    defaultCalendar: WritableDefaultCalendar | null,
    onSave: (event: CalendarEventRecord) => Promise<void>,
    actions: CalendarEditorActions,
  ) {
    super(app);
    this.draft = { ...event };
    this.defaultCalendar = defaultCalendar;
    this.onSave = onSave;
    this.actions = actions;
    this.initialSource = event.source;
  }

  onOpen(): void {
    const capabilities = calendarEditorCapabilities(this.draft);
    const fieldsReadOnly = this.initialSource === "external" && Boolean(this.draft.readOnly);
    this.titleEl.setText(this.draft.title ? "Edit event" : "New event");
    const statusLabel = calendarStatusLabel(this.draft.syncState);
    if (statusLabel) {
      new Setting(this.contentEl)
        .setName("Status")
        .setDesc(calendarStatusDescription(this.draft.syncState) ?? statusLabel);
    }
    new Setting(this.contentEl).setName("Title").addText((text) => text
      .setValue(this.draft.title)
      .setDisabled(fieldsReadOnly)
      .onChange((value) => { this.draft.title = value; }));
    new Setting(this.contentEl).setName("Start").addText((text) => text
      .setValue(this.draft.start)
      .setDisabled(fieldsReadOnly)
      .onChange((value) => { this.draft.start = value; }));
    new Setting(this.contentEl).setName("End").addText((text) => text
      .setValue(this.draft.end)
      .setDisabled(fieldsReadOnly)
      .onChange((value) => { this.draft.end = value; }));
    new Setting(this.contentEl).setName("All day").addToggle((toggle) => toggle
      .setValue(this.draft.allDay)
      .setDisabled(fieldsReadOnly)
      .onChange((value) => { this.draft.allDay = value; }));
    new Setting(this.contentEl).setName("Location").addText((text) => text
      .setValue(this.draft.location ?? "")
      .setDisabled(fieldsReadOnly)
      .onChange((value) => { this.draft.location = value.trim() || undefined; }));
    if (capabilities.showDestination) {
      new Setting(this.contentEl)
        .setName("Destination")
        .setDesc(destinationDescription(this.initialSource))
        .addDropdown((dropdown) => {
        for (const option of destinationOptions(this.initialSource, this.defaultCalendar?.title)) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(this.draft.source).onChange((value) => {
          this.draft.source = value as EventSource;
        });
      });
    }
    this.renderActionHooks();
    const footer = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
    if (capabilities.showSave) {
      footer.addButton((button) => button.setCta().setButtonText("Save").onClick(async () => {
          await this.saveDraft();
        }));
    }
  }

  onClose(): void { this.contentEl.empty(); }

  private renderActionHooks(): void {
    const syncState = this.draft.syncState as string | undefined;
    const capabilities = calendarEditorCapabilities(this.draft);
    if (this.initialSource === "linked") {
      new Setting(this.contentEl)
        .setName("Detach link")
        .setDesc("Keep the note and stop syncing it to Apple Calendar.")
        .addButton((button) => button.setButtonText("Detach").onClick(async () => {
          await this.runDetachAction(false, "Detach is not available until main.ts wires detachCalendarEvent(event, false).");
        }));
      if (syncState === "unavailable") {
        new Setting(this.contentEl)
          .setName("Recreate in default calendar")
          .setDesc("Create a fresh Apple Calendar copy using the current writable default calendar.")
          .addButton((button) => button.setCta().setButtonText("Recreate").onClick(async () => {
            await this.recreateCalendarCopy();
          }));
      }
    }
    if (capabilities.showCreateLinkedNote) {
      new Setting(this.contentEl)
        .setName("Create linked vault note")
        .setDesc("Save this read-only calendar event as a linked Markdown note. Apple Calendar will not be modified.")
        .addButton((button) => button.setCta().setButtonText("Create note").onClick(async () => {
          try {
            await this.onSave({ ...this.draft, source: "linked", syncState: "clean" });
            this.close();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Could not create linked note");
          }
        }));
    }
    if (capabilities.showDelete) {
      new Setting(this.contentEl)
        .setName("Delete calendar copy")
        .setDesc(this.initialSource === "external"
          ? "Delete the Calendar event."
          : "Delete the Calendar event and leave the note detached.")
        .addButton((button) => {
          button.buttonEl.addClass("mod-warning");
          button.setButtonText("Delete").onClick(async () => {
            await this.runDetachAction(true, "Delete is not available until main.ts wires detachCalendarEvent(event, true).");
          });
        });
    }
  }

  private async recreateCalendarCopy(): Promise<void> {
    const title = this.draft.title.trim();
    if (!title) return void new Notice("Event title is required");
    const validationError = validateCalendarEventRange(this.draft.start, this.draft.end);
    if (validationError) return void new Notice(validationError);
    if (!this.defaultCalendar) {
      return void new Notice("Choose a writable default calendar in OMD Home settings first");
    }
    try {
      await this.onSave({
        ...this.draft,
        title,
        source: "linked",
        appleCalendarId: this.defaultCalendar.id,
        appleItemId: undefined,
        appleExternalId: undefined,
        occurrenceDate: undefined,
        syncState: "pending",
      });
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not recreate Calendar copy");
    }
  }

  private async runDetachAction(deleteExternal: boolean, missingActionMessage: string): Promise<void> {
    if (!this.actions.detachCalendarEvent) {
      new Notice(missingActionMessage);
      return;
    }
    try {
      await this.actions.detachCalendarEvent(this.draft, deleteExternal);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not update Calendar link");
    }
  }

  private async saveDraft(): Promise<void> {
    const blockReason = calendarEditorSaveBlockReason(this.draft);
    if (blockReason) return void new Notice(blockReason);
    const title = this.draft.title.trim();
    if (!title) return void new Notice("Event title is required");
    const validationError = validateCalendarEventRange(this.draft.start, this.draft.end);
    if (validationError) return void new Notice(validationError);
    if (this.draft.source === "linked" && !this.draft.appleCalendarId && !this.defaultCalendar) {
      return void new Notice("Choose a writable default calendar in OMD Home settings first");
    }
    try {
      await this.onSave({ ...this.draft, title });
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not save event");
    }
  }
}

export interface CalendarEditorCapabilities {
  showSave: boolean;
  showDelete: boolean;
  showDestination: boolean;
  showCreateLinkedNote: boolean;
}

export function calendarEditorCapabilities(event: CalendarEventRecord): CalendarEditorCapabilities {
  const unavailableLinked = event.source === "linked" && event.syncState === "unavailable";
  const readOnlyExternal = event.source === "external" && Boolean(event.readOnly);
  return {
    showSave: !unavailableLinked && !readOnlyExternal,
    showDelete: Boolean(event.appleItemId)
      && !event.readOnly
      && event.syncState !== "error"
      && event.syncState !== "unavailable",
    showDestination: !unavailableLinked && !readOnlyExternal,
    showCreateLinkedNote: readOnlyExternal,
  };
}

export function calendarEditorSaveBlockReason(event: CalendarEventRecord): string | undefined {
  if (event.source === "linked" && event.syncState === "unavailable") {
    return "This Calendar event is unavailable. Use Recreate or Detach instead of Save";
  }
  if (event.source === "external" && event.readOnly) {
    return "This Calendar is read-only. Create a linked vault note instead";
  }
  return undefined;
}

interface WritableDefaultCalendar {
  id: string;
  title: string;
}

interface CalendarDestinationOption {
  value: EventSource;
  label: string;
}

export interface CalendarViewPluginActions {
  synchronizeCalendarEvents?: () => Promise<void>;
  detachCalendarEvent?: (event: CalendarEventRecord, deleteExternal: boolean) => Promise<void>;
}

interface CalendarEditorActions {
  detachCalendarEvent?: (event: CalendarEventRecord, deleteExternal: boolean) => Promise<void>;
}

export function destinationOptions(
  source: EventSource,
  defaultCalendarTitle?: string,
): CalendarDestinationOption[] {
  const linkedLabel = defaultCalendarTitle
    ? `Vault + ${defaultCalendarTitle}`
    : "Vault + default Calendar (choose in settings)";
  if (source === "external") {
    return [
      { value: "external", label: "Calendar only" },
      { value: "linked", label: "Create linked vault note" },
    ];
  }
  if (source === "linked") return [{ value: "linked", label: linkedLabel }];
  return [
    { value: "vault", label: "Vault note only" },
    { value: "linked", label: linkedLabel },
  ];
}

function destinationDescription(source: EventSource): string {
  if (source === "external") return "Keep this as a Calendar event, or create a linked note for it.";
  if (source === "linked") return "Linked events stay linked here. Use the explicit actions below to detach, delete, or recreate the Calendar copy.";
  return "Keep a Markdown-only event, or link the note to the writable default macOS Calendar.";
}

export function validateCalendarEventRange(start: string, end: string): string | null {
  const parsedStart = parseIsoBoundary(start);
  if (!parsedStart) return "Start must be an ISO date or timestamp";
  const parsedEnd = parseIsoBoundary(end);
  if (!parsedEnd) return "End must be an ISO date or timestamp";
  if (parsedStart.kind !== parsedEnd.kind) {
    return "Start and end must both be ISO dates or both be timestamps";
  }
  if (parsedStart.kind === "date" && parsedEnd.kind === "date" && parsedStart.value >= parsedEnd.value) {
    return "End must be after start";
  }
  if (parsedStart.kind === "timestamp" && parsedEnd.kind === "timestamp" && parsedStart.value >= parsedEnd.value) {
    return "End must be after start";
  }
  return null;
}

function parseIsoBoundary(value: string): { kind: "date" | "timestamp"; value: number | string } | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day
    ) return null;
    return { kind: "date", value: trimmed };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : { kind: "timestamp", value: parsed };
}

export function calendarStatusLabel(syncState: string | undefined): string | null {
  if (syncState === "pending") return "Pending sync";
  if (syncState === "conflict") return "Conflict";
  if (syncState === "unavailable") return "Unavailable";
  if (syncState === "error") return "Sync paused";
  return null;
}

function calendarStatusDescription(syncState: string | undefined): string | null {
  if (syncState === "pending") return "This event has one-sided changes waiting for explicit sync.";
  if (syncState === "conflict") return "This event changed in both places and needs a resolution choice.";
  if (syncState === "unavailable") return "This linked event is unavailable because its Calendar is deselected or the external item is missing.";
  if (syncState === "error") return "Calendar could not be read safely. Retry sync before making linked-event changes.";
  return null;
}

function statusClass(syncState: string | undefined): string {
  if (syncState === "pending") return "omd-fc-pending";
  if (syncState === "conflict") return "omd-fc-conflict";
  if (syncState === "unavailable") return "omd-fc-unavailable";
  if (syncState === "error") return "omd-fc-error";
  return "";
}

function resolveWritableDefaultCalendar(
  calendars: ExternalCalendarDescriptor[],
  settings: Pick<OmdHomePlugin["settings"], "defaultExternalCalendarId" | "selectedCalendarIds">,
): WritableDefaultCalendar | null {
  const defaultCalendar = calendars.find((calendar) => (
    calendar.id === settings.defaultExternalCalendarId
    && calendar.allowsModifications
    && settings.selectedCalendarIds.includes(calendar.id)
  ));
  return defaultCalendar ? { id: defaultCalendar.id, title: defaultCalendar.title } : null;
}

function calendarEditorActions(plugin: OmdHomePlugin): CalendarEditorActions {
  const actions = plugin as OmdHomePlugin & CalendarViewPluginActions;
  return { detachCalendarEvent: actions.detachCalendarEvent?.bind(plugin) };
}

function toFullCalendarEvent(event: CalendarEventRecord): Record<string, unknown> {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: calendarEventEditable(event),
    extendedProps: { source: event.source, syncState: event.syncState, notePath: event.notePath },
  };
}

export function calendarEventEditable(event: Pick<CalendarEventRecord, "source" | "syncState" | "readOnly">): boolean {
  if (event.readOnly) return false;
  return event.source !== "linked" || !event.syncState || event.syncState === "clean";
}

export function requiresSyncBeforeEdit(
  event: Pick<CalendarEventRecord, "syncState" | "pendingDirection">,
): boolean {
  return event.syncState === "error"
    || (event.syncState === "pending" && event.pendingDirection === "external");
}

function legendItem(container: HTMLElement, source: EventSource, label: string): void {
  const item = container.createDiv({ cls: "omd-legend-item" });
  item.createSpan({ cls: `omd-source-mark is-${source}` });
  item.createSpan({ text: label });
}
