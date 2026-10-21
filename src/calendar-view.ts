import { ItemView, Modal, Notice, Setting, WorkspaceLeaf, type App } from "obsidian";
import { Calendar, type DateSelectInfo, type EventChangeInfo, type EventClickInfo, type EventDisplayInfo } from "fullcalendar";
import dayGridPlugin from "fullcalendar/daygrid";
import timeGridPlugin from "fullcalendar/timegrid";
import listPlugin from "fullcalendar/list";
import interactionPlugin from "fullcalendar/interaction";
import classicThemePlugin from "fullcalendar/themes/classic";
import type OmdHomePlugin from "./main";
import type {
  CalendarEventRecord,
  CalendarUnavailableReason,
  EventSource,
  ExternalCalendarDescriptor,
} from "./model";
import {
  CALENDAR_DETACH_CONFIRMATION,
  CALENDAR_EVENT_DELETE_CONFIRMATION,
  CALENDAR_NOTE_DELETE_CONFIRMATION,
  CALENDAR_RECREATE_CONFIRMATION,
  CalendarPartialActionError,
  calendarSyncResultMessage,
  isCalendarNoteErrorRecord,
  type CalendarDetachConfirmation,
  type CalendarNoteDeleteConfirmation,
  type CalendarRecreateConfirmation,
  type CalendarSyncSummary,
} from "./calendar-sync";
import {
  EVENT_SOURCE_ORDER,
  calendarConflictVersionFields,
  calendarEditorInputValue,
  calendarEditorRangeForMode,
  calendarEditorStoredValue,
  calendarRecoveryPresentation,
  calendarRangeValidationTarget,
  calendarRangeValidationMessage,
  deviceTimeZoneDescription,
  deviceTimeZoneName,
  eventMatchesSourceFilter,
  eventSourceFilterControlState,
  eventSourceFilterSummary,
  eventSourcePresentation,
  normalizeSourceFilters,
  replaceCalendarEvents,
  toggleSourceFilter,
} from "./calendar-ui";

export const CALENDAR_VIEW_TYPE = "omd-home-calendar";

const calendarModalActionGuards = new WeakMap<Modal, () => boolean>();

export function setCalendarModalActionGuard(modal: Modal, guard: () => boolean): void {
  calendarModalActionGuards.set(modal, guard);
}

interface CalendarEventContentArg {
  event: {
    id: string;
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
  private hostEl?: HTMLDivElement;
  private syncButton?: HTMLButtonElement;
  private sourceFilterSummaryEl?: HTMLElement;
  private syncing = false;
  private readonly plugin: OmdHomePlugin;
  private readonly ownedModals = new Set<Modal>();
  private lifecycleGeneration = 0;
  private enabledSources = normalizeSourceFilters();

  constructor(leaf: WorkspaceLeaf, plugin: OmdHomePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return CALENDAR_VIEW_TYPE; }
  getDisplayText(): string { return "OMD calendar"; }
  getIcon(): string { return "calendar-days"; }

  async onOpen(): Promise<void> {
    const generation = ++this.lifecycleGeneration;
    await this.plugin.refreshCalendarEvents();
    if (generation !== this.lifecycleGeneration) return;
    this.render();
  }
  async onClose(): Promise<void> {
    this.lifecycleGeneration += 1;
    for (const modal of [...this.ownedModals]) modal.close();
    this.ownedModals.clear();
    this.calendar?.destroy();
    this.calendar = undefined;
    this.hostEl = undefined;
    this.sourceFilterSummaryEl = undefined;
  }

  render(): void {
    this.ensureShell();
    if (!this.calendar && this.hostEl) {
      this.calendar = new Calendar(this.hostEl, {
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
        events: this.visibleEvents().map(toFullCalendarEvent),
        select: (selection) => this.createFromSelection(selection),
        eventClick: (info) => this.openEvent(info),
        eventChange: (info) => void this.commitChange(info),
        eventContent: (info: CalendarEventContentArg) => {
          const content = createSpan();
          const monthView = info.view.type === "dayGridMonth";
          content.className = `omd-calendar-event-content${monthView ? " is-month-view" : ""}`;
          const source = info.event.extendedProps.source as EventSource;
          const sourcePresentation = eventSourcePresentation(source);
          const statusLabel = calendarRecoveryPresentation({
            id: info.event.id,
            notePath: info.event.extendedProps.notePath as string | undefined,
            syncState: info.event.extendedProps.syncState as CalendarEventRecord["syncState"],
            unavailableReason: info.event.extendedProps.unavailableReason as CalendarUnavailableReason | undefined,
          })?.label ?? calendarStatusLabel(info.event.extendedProps.syncState as string | undefined);
          const accessibleTime = info.timeText || "All day";
          const accessibleLabel = [info.event.title, accessibleTime, sourcePresentation.label, statusLabel]
            .filter(Boolean)
            .join(" · ");
          content.title = accessibleLabel;
          content.setAttribute("aria-label", accessibleLabel);
          content.createSpan({
            cls: `omd-calendar-event-source is-${source}`,
            text: sourcePresentation.glyph,
            attr: { "aria-hidden": "true" },
          });
          if (info.timeText) {
            const time = content.createSpan({ cls: "omd-calendar-event-time", text: info.timeText });
            time.setAttribute("aria-hidden", "true");
          }
          content.createSpan({ cls: "omd-calendar-event-title", text: info.event.title, attr: { dir: "auto" } });
          if (!monthView && statusLabel) {
            content.createSpan({
              cls: "omd-calendar-event-status",
              attr: { "aria-hidden": "true" },
            });
            content.createSpan({ cls: "omd-calendar-event-status-label", text: statusLabel });
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
    if (!this.calendar) return;
    this.calendar.setOption("colorScheme", document.body.classList.contains("theme-dark") ? "dark" : "light");
    replaceCalendarEvents(this.calendar, this.visibleEvents().map(toFullCalendarEvent));
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
    this.openTrackedModal(new EventEditorModal(this.app, event, defaultCalendar, async (saved) => {
      await this.plugin.saveCalendarEvent(saved);
      this.render();
    }, calendarEditorActions(this.plugin, (modal) => this.trackModal(modal))));
  }

  private openEvent(info: EventClickInfo): void {
    const record = this.plugin.calendarEvents.find((event) => event.id === info.event.id);
    if (!record) return;
    if (requiresSyncBeforeEdit(record)) {
      this.openTrackedModal(new SyncRequiredModal(this.app, record, async () => {
        const summary = await this.plugin.synchronizeCalendarEvents();
        new Notice(calendarSyncResultMessage(summary));
        this.render();
      }));
      return;
    }
    if (record.syncState === "conflict" && record.conflictExternal) {
      this.openTrackedModal(new EventConflictModal(this.app, record, async (choice) => {
        await this.plugin.resolveCalendarConflict(record, choice);
        this.render();
      }));
      return;
    }
    const defaultCalendar = resolveWritableDefaultCalendar(this.plugin.externalCalendars, this.plugin.settings);
    this.openTrackedModal(new EventEditorModal(this.app, record, defaultCalendar, async (event) => {
      await this.plugin.saveCalendarEvent(event);
      this.render();
    }, calendarEditorActions(this.plugin, (modal) => this.trackModal(modal))));
  }

  private trackModal<T extends Modal>(modal: T): T | null {
    const generation = this.lifecycleGeneration;
    this.ownedModals.add(modal);
    const tracked = this.plugin.trackCalendarModal(
      modal,
      () => this.ownedModals.delete(modal),
      () => generation === this.lifecycleGeneration,
    );
    if (!tracked) this.ownedModals.delete(modal);
    return tracked;
  }

  private openTrackedModal<T extends Modal>(modal: T): void {
    this.trackModal(modal)?.open();
  }

  private async commitChange(info: EventChangeInfo): Promise<void> {
    const existing = this.plugin.calendarEvents.find((event) => event.id === info.event.id);
    if (!existing) return info.revert();
    const start = info.event.allDay
      ? info.event.startStr || existing.start
      : info.event.start?.toISOString() ?? existing.start;
    const end = info.event.allDay
      ? info.event.endStr || info.event.startStr || existing.end
      : info.event.end?.toISOString() ?? info.event.start?.toISOString() ?? existing.end;
    const validationError = validateCalendarEventRange(start, end);
    if (validationError) {
      info.revert();
      new Notice(validationError);
      return;
    }
    try {
      await this.plugin.saveCalendarEvent({
        ...existing,
        externalStartHint: existing.occurrenceDate && existing.appleItemId
          ? existing.start
          : existing.externalStartHint,
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
    if (this.syncing) return;
    this.syncing = true;
    if (this.syncButton) {
      this.syncButton.disabled = true;
      this.syncButton.setText("Syncing…");
    }
    const plugin = this.plugin as OmdHomePlugin & CalendarViewPluginActions;
    try {
      if (plugin.synchronizeCalendarEvents) {
        const summary = await plugin.synchronizeCalendarEvents();
        new Notice(calendarSyncResultMessage(summary));
      } else {
        await this.plugin.refreshCalendarEvents();
      }
      this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not sync calendars");
    } finally {
      this.syncing = false;
      if (this.syncButton) {
        this.syncButton.disabled = false;
        this.syncButton.setText("Sync");
      }
    }
  }

  private toggleSource(source: EventSource): void {
    if (this.enabledSources.has(source) && this.enabledSources.size === 1) {
      new Notice("At least one event source must remain visible");
      return;
    }
    this.enabledSources = toggleSourceFilter(this.enabledSources, source);
    if (!this.calendar) {
      this.render();
      return;
    }
    replaceCalendarEvents(this.calendar, this.visibleEvents().map(toFullCalendarEvent));
    this.contentEl.querySelectorAll<HTMLButtonElement>(".omd-calendar-filter-button").forEach((button) => {
      const buttonSource = button.dataset.source as EventSource | undefined;
      if (!buttonSource) return;
      updateSourceFilterButton(button, this.enabledSources, buttonSource);
    });
    this.updateSourceFilterSummary();
  }

  private visibleEvents(): CalendarEventRecord[] {
    return this.plugin.calendarEvents.filter((event) => eventMatchesSourceFilter(event.source, this.enabledSources));
  }

  private ensureShell(): void {
    if (this.hostEl?.isConnected && this.calendar) return;
    if (this.calendar && !this.hostEl?.isConnected) {
      this.calendar.destroy();
      this.calendar = undefined;
    }
    this.contentEl.empty();
    this.contentEl.addClass("omd-calendar-view");
    const shell = this.contentEl.createDiv({ cls: "omd-calendar-shell" });
    const topbar = shell.createDiv({ cls: "omd-calendar-topbar" });
    const sourceFilter = topbar.createEl("details", { cls: "omd-calendar-source-filter" });
    this.sourceFilterSummaryEl = sourceFilter.createEl("summary", {
      cls: "omd-calendar-source-summary",
      text: eventSourceFilterSummary(this.enabledSources),
      attr: { "aria-label": `${eventSourceFilterSummary(this.enabledSources)}. Filter events by source.` },
    });
    const sourceOptions = sourceFilter.createDiv({
      cls: "omd-calendar-source-options",
      attr: { role: "group", "aria-label": "Event sources" },
    });
    for (const source of EVENT_SOURCE_ORDER) {
      sourceFilterButton(sourceOptions, this.enabledSources, source, () => this.toggleSource(source));
    }
    const actions = topbar.createDiv({ cls: "omd-calendar-actions" });
    const sync = actions.createEl("button", { cls: "omd-action-button", type: "button", text: "Sync" });
    this.syncButton = sync;
    sync.addEventListener("click", () => void this.syncEvents());
    const create = actions.createEl("button", { cls: "mod-cta omd-action-button", type: "button", text: "New event" });
    create.addEventListener("click", () => this.createEvent());
    this.hostEl = shell.createDiv({ cls: "omd-calendar-host" });
  }

  private updateSourceFilterSummary(): void {
    const summary = eventSourceFilterSummary(this.enabledSources);
    this.sourceFilterSummaryEl?.setText(summary);
    this.sourceFilterSummaryEl?.setAttribute("aria-label", `${summary}. Filter events by source.`);
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
    this.modalEl.addClass("omd-event-conflict-modal");
    this.titleEl.setText("Calendar conflict");
    this.contentEl.createEl("p", { text: "This linked event changed in both its note and calendar." });
    this.contentEl.createEl("p", {
      cls: "omd-conflict-help",
      text: "Nothing has been overwritten. Compare both versions, then choose which one should become the linked event.",
    });
    const versions = this.contentEl.createDiv({ cls: "omd-conflict-versions" });
    this.renderVersion(versions, "Note version", this.event);
    this.renderVersion(versions, "Calendar version", this.event.conflictExternal ?? this.event);
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Use note version").onClick(async () => this.resolve("vault")))
      .addButton((button) => button.setButtonText("Use calendar version").onClick(async () => this.resolve("external")));
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void { this.contentEl.empty(); }

  private async resolve(choice: "vault" | "external"): Promise<void> {
    await runCalendarModalAction(this, () => this.onResolve(choice), "Could not resolve Calendar conflict");
  }

  private renderVersion(container: HTMLElement, label: string, event: CalendarEventRecord): void {
    const version = container.createEl("section", { cls: "omd-conflict-version" });
    version.createEl("h3", { text: label });
    const fields = version.createEl("dl");
    for (const field of calendarConflictVersionFields(event)) {
      fields.createEl("dt", { text: field.label });
      fields.createEl("dd", { text: field.value, attr: { dir: field.label === "Time" ? "ltr" : "auto" } });
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
    this.modalEl.addClass("omd-sync-required-modal");
    const failed = this.event.syncState === "error";
    this.titleEl.setText(failed ? "Calendar sync paused" : "Calendar has newer changes");
    this.contentEl.createEl("p", {
      text: failed
        ? "OMD Home could not safely read Calendar. Check Calendar setup in OMD Home settings, then retry Sync. The event has not been treated as missing."
        : "Import the newer Calendar version before editing this linked note, so the external change is not overwritten.",
    });
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText(failed ? "Retry sync" : "Import Calendar change").onClick(async () => {
        await runCalendarModalAction(this, this.onSync, "Could not sync Calendar");
      }));
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void { this.contentEl.empty(); }
}

export interface CalendarConfirmationIdentityField {
  label: "Title" | "Time" | "Note path" | "Calendar" | "Target calendar";
  value: string;
  dir: "auto" | "ltr";
}

export function calendarConfirmationIdentityFields(
  event: CalendarEventRecord,
  details: { notePath?: boolean; calendar?: boolean; targetCalendar?: string },
): CalendarConfirmationIdentityField[] {
  const identity = calendarConflictVersionFields(event);
  const title = identity.find((field) => field.label === "Title")?.value ?? event.title;
  const time = identity.find((field) => field.label === "Time")?.value ?? `${event.start} – ${event.end}`;
  const fields = [
    { label: "Title", value: title, dir: "auto" },
    { label: "Time", value: time, dir: "ltr" },
  ] as CalendarConfirmationIdentityField[];
  if (details.calendar || details.targetCalendar) {
    fields.push({
      label: details.targetCalendar ? "Target calendar" : "Calendar",
      value: details.targetCalendar ?? (event.calendar?.trim() || "Calendar"),
      dir: "auto",
    });
  }
  if (details.notePath) {
    fields.push({ label: "Note path", value: event.notePath ?? "Unavailable", dir: "auto" });
  }
  return fields;
}

function renderCalendarConfirmationIdentity(
  container: HTMLElement,
  event: CalendarEventRecord,
  details: { notePath?: boolean; calendar?: boolean; targetCalendar?: string },
): void {
  const summary = container.createEl("section", {
    cls: "omd-conflict-version omd-calendar-confirmation-identity",
  });
  summary.createEl("h3", { text: "Selected event" });
  const fields = summary.createEl("dl");
  for (const field of calendarConfirmationIdentityFields(event, details)) {
    fields.createEl("dt", { text: field.label });
    fields.createEl("dd", { text: field.value, attr: { dir: field.dir } });
  }
}

class RecreateCalendarConfirmationModal extends Modal {
  constructor(
    app: App,
    private readonly event: CalendarEventRecord,
    private readonly targetCalendar: WritableDefaultCalendar,
    private readonly onConfirm: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("omd-calendar-recreate-modal");
    this.titleEl.setText("Recreate calendar event?");
    this.contentEl.createEl("p", {
      text: "Apple may change an event identifier after an event moves between calendars or calendar performs a full sync.",
    });
    this.contentEl.createEl("p", {
      text: "Check calendar first and continue only if the original event is gone. Continuing while it still exists will create a duplicate.",
    });
    renderCalendarConfirmationIdentity(this.contentEl, this.event, {
      targetCalendar: this.targetCalendar.title,
      notePath: true,
    });
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.buttonEl.addClass("mod-warning");
        button.setButtonText("Recreate anyway").onClick(async () => this.confirm());
      });
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void { this.contentEl.empty(); }

  private async confirm(): Promise<void> {
    await runCalendarModalAction(this, this.onConfirm, "Could not recreate Calendar event");
  }
}

class DeleteEventNoteConfirmationModal extends Modal {
  constructor(
    app: App,
    private readonly event: CalendarEventRecord,
    private readonly linked: boolean,
    private readonly onConfirm: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("omd-calendar-delete-modal");
    this.titleEl.setText("Delete event note?");
    this.contentEl.createEl("p", {
      text: this.linked
        ? "Move this Markdown event note to Obsidian's trash. OMD Home will not delete or modify Apple Calendar."
        : "Move this Markdown event note to Obsidian's trash.",
    });
    renderCalendarConfirmationIdentity(this.contentEl, this.event, { notePath: true });
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.buttonEl.addClass("mod-warning");
        button.setButtonText("Move to trash").onClick(async () => this.confirm());
      });
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void { this.contentEl.empty(); }

  private async confirm(): Promise<void> {
    await runCalendarModalAction(this, this.onConfirm, "Could not delete event note");
  }
}

class DeleteCalendarEventConfirmationModal extends Modal {
  constructor(
    app: App,
    private readonly event: CalendarEventRecord,
    private readonly linked: boolean,
    private readonly onConfirm: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("omd-calendar-delete-modal");
    this.titleEl.setText(this.linked ? "Delete Calendar copy?" : "Delete Calendar event?");
    this.contentEl.createEl("p", {
      text: this.linked
        ? "The Apple Calendar event will be removed. The Markdown note will remain as Vault only."
        : "This removes the event from Apple Calendar. No vault note will remain.",
    });
    renderCalendarConfirmationIdentity(this.contentEl, this.event, { calendar: true });
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.buttonEl.addClass("mod-warning");
        button.setButtonText("Delete event").onClick(async () => this.confirm());
      });
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void { this.contentEl.empty(); }

  private async confirm(): Promise<void> {
    await runCalendarModalAction(this, this.onConfirm, "Could not delete Calendar event");
  }
}

let eventEditorSequence = 0;

class EventEditorModal extends Modal {
  private draft: CalendarEventRecord;
  private readonly defaultCalendar: WritableDefaultCalendar | null;
  private readonly onSave: (event: CalendarEventRecord) => Promise<void>;
  private readonly actions: CalendarEditorActions;
  private readonly initialSource: EventSource;
  private readonly controlId = `omd-event-editor-${++eventEditorSequence}`;
  private startInput?: HTMLInputElement;
  private endInput?: HTMLInputElement;
  private rangeValidationEl?: HTMLDivElement;
  private allDayToggleEl?: HTMLElement;

  constructor(
    app: App,
    event: CalendarEventRecord,
    defaultCalendar: WritableDefaultCalendar | null,
    onSave: (event: CalendarEventRecord) => Promise<void>,
    actions: CalendarEditorActions,
  ) {
    super(app);
    this.draft = {
      ...event,
      externalStartHint: event.occurrenceDate && event.appleItemId
        ? event.start
        : event.externalStartHint,
    };
    this.defaultCalendar = defaultCalendar;
    this.onSave = onSave;
    this.actions = actions;
    this.initialSource = event.source;
  }

  onOpen(): void {
    this.modalEl.addClass("omd-event-modal");
    const capabilities = calendarEditorCapabilities(this.draft);
    const fieldsReadOnly = Boolean(this.draft.readOnly)
      || (this.initialSource === "linked"
        && (this.draft.syncState === "unavailable" || this.draft.syncState === "error"));
    this.titleEl.setText(this.draft.title ? "Edit event" : "New event");
    const recovery = calendarRecoveryPresentation(this.draft);
    const statusLabel = recovery?.label ?? calendarStatusLabel(this.draft.syncState);
    if (recovery) {
      const state = this.contentEl.createDiv({
        cls: `omd-calendar-recovery${this.draft.syncState === "error" ? " is-error" : ""}`,
      });
      state.createEl("strong", { text: recovery.label });
      state.createEl("p", { text: recovery.description });
    } else if (statusLabel) {
      new Setting(this.contentEl)
        .setName("Status")
        .setDesc(calendarStatusDescription(this.draft.syncState) ?? statusLabel);
    }
    new Setting(this.contentEl).setName("Title").addText((text) => {
      text.inputEl.dir = "auto";
      text
        .setValue(this.draft.title)
        .setDisabled(fieldsReadOnly)
        .onChange((value) => { this.draft.title = value; });
    });
    this.startInput = this.renderBoundaryInput("Start", this.draft.allDay
      ? "The first day of this event."
      : "Event start date and time.", fieldsReadOnly, "start");
    this.endInput = this.renderBoundaryInput("End", this.draft.allDay
      ? "All-day events end at the start of this date. For one day, choose the next date."
      : "Event end date and time.", fieldsReadOnly, "end");
    this.rangeValidationEl = this.contentEl.createDiv({
      cls: "omd-event-validation is-error",
      attr: {
        id: `${this.controlId}-range-error`,
        role: "alert",
      },
    });
    this.rangeValidationEl.hidden = true;
    if (!this.draft.allDay) {
      this.contentEl.createEl("p", {
        cls: "omd-event-timezone",
        text: deviceTimeZoneDescription(),
        attr: { id: `${this.controlId}-timezone-help` },
      });
    }
    new Setting(this.contentEl).setName("All day").setDesc("Store this event as calendar dates instead of times.").addToggle((toggle) => {
      this.allDayToggleEl = toggle.toggleEl;
      toggle
        .setValue(this.draft.allDay)
        .setDisabled(fieldsReadOnly)
        .onChange((value) => {
        if (pendingCalendarActions.has(this)) {
          toggle.setValue(this.draft.allDay);
          return;
        }
        const range = calendarEditorRangeForMode(this.draft.start, this.draft.end, value);
        if (range) {
          this.draft.start = range.start;
          this.draft.end = range.end;
        }
        this.draft.allDay = value;
        this.contentEl.empty();
        this.onOpen();
        this.allDayToggleEl?.focus();
      });
    });
    new Setting(this.contentEl).setName("Location").addText((text) => {
      text.inputEl.dir = "auto";
      text
        .setValue(this.draft.location ?? "")
        .setDisabled(fieldsReadOnly)
        .onChange((value) => { this.draft.location = value.trim() || undefined; });
    });
    if (capabilities.showDestination) {
      const linkedCalendarTitle = this.initialSource === "linked"
        ? this.draft.calendar?.trim() || undefined
        : undefined;
      new Setting(this.contentEl)
        .setName("Destination")
        .setDesc(destinationDescription(this.initialSource, linkedCalendarTitle))
        .addDropdown((dropdown) => {
        for (const option of destinationOptions(
          this.initialSource,
          this.defaultCalendar?.title,
          linkedCalendarTitle,
        )) {
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
    footer.settingEl.addClass("omd-modal-actions");
    if (capabilities.showSave) {
      footer.addButton((button) => button.setCta().setButtonText("Save").onClick(async () => {
          await this.saveDraft();
        }));
    }
  }

  onClose(): void { this.contentEl.empty(); }

  private renderBoundaryInput(
    label: "Start" | "End",
    description: string,
    readOnly: boolean,
    key: "start" | "end",
  ): HTMLInputElement {
    const setting = new Setting(this.contentEl).setName(label).setDesc(description);
    const helpId = `${this.controlId}-${key}-help`;
    setting.descEl.id = helpId;
    const input = setting.controlEl.createEl("input", {
      cls: "omd-calendar-boundary-input",
      type: this.draft.allDay ? "date" : "datetime-local",
    });
    input.value = calendarEditorInputValue(this.draft[key], this.draft.allDay);
    input.disabled = readOnly;
    input.required = true;
    input.setAttribute("aria-describedby", this.boundaryDescriptionIds(key));
    if (!this.draft.allDay) input.step = "900";
    input.ariaLabel = `${label} ${this.draft.allDay ? "date" : "date and time"}`;
    input.title = this.draft.allDay
      ? `${label} date`
      : `${label} in ${deviceTimeZoneName()}`;
    input.addEventListener("change", () => {
      const stored = calendarEditorStoredValue(input.value, this.draft.allDay);
      this.draft[key] = stored ?? "";
      if (this.rangeValidationEl && !this.rangeValidationEl.hidden) this.refreshRangeValidation(false);
    });
    return input;
  }

  private refreshRangeValidation(focusEnd: boolean): boolean {
    const validationError = validateCalendarEventRange(this.draft.start, this.draft.end);
    const message = calendarRangeValidationMessage(validationError, this.draft.allDay);
    if (!message) {
      this.clearRangeValidation();
      return true;
    }
    const validation = this.rangeValidationEl;
    const startInput = this.startInput;
    const endInput = this.endInput;
    if (!validation || !startInput || !endInput || !validationError) return false;
    this.clearRangeValidation();
    validation.setText(message);
    validation.hidden = false;
    const target = calendarRangeValidationTarget(validationError);
    const invalidInputs = target === "both"
      ? [startInput, endInput]
      : target === "start"
        ? [startInput]
        : [endInput];
    for (const input of invalidInputs) {
      const key = input === startInput ? "start" : "end";
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", this.boundaryDescriptionIds(key, validation.id));
    }
    if (focusEnd) invalidInputs[0]?.focus();
    return false;
  }

  private clearRangeValidation(): void {
    if (this.rangeValidationEl) {
      this.rangeValidationEl.empty();
      this.rangeValidationEl.hidden = true;
    }
    for (const [key, input] of [["start", this.startInput], ["end", this.endInput]] as const) {
      if (!input) continue;
      input.removeAttribute("aria-invalid");
      input.setAttribute("aria-describedby", this.boundaryDescriptionIds(key));
    }
  }

  private boundaryDescriptionIds(key: "start" | "end", validationId?: string): string {
    return [
      `${this.controlId}-${key}-help`,
      this.draft.allDay ? null : `${this.controlId}-timezone-help`,
      validationId,
    ].filter((value): value is string => Boolean(value)).join(" ");
  }

  private renderActionHooks(): void {
    const capabilities = calendarEditorCapabilities(this.draft);
    if (this.initialSource === "linked") {
      if (capabilities.showRetrySync) {
        new Setting(this.contentEl)
          .setName("Check calendar again")
          .setDesc("Sync all linked events and recheck this event before making a copy.")
          .addButton((button) => button.setCta().setButtonText("Retry full sync").onClick(async () => {
            await this.retryCalendarSync();
          }));
      }
      if (capabilities.showRecreate) {
        new Setting(this.contentEl)
          .setName(`Recreate in ${this.defaultCalendar?.title ?? "default calendar"}`)
          .setDesc("Use this only after checking that the original event is gone. OMD Home rechecks before creating another copy.")
          .addButton((button) => button.setButtonText("Recreate…").onClick(async () => {
            await this.recreateCalendarCopy();
          }));
      }
      if (capabilities.showDetach) {
        new Setting(this.contentEl)
          .setName("Detach link")
          .setDesc("Keep the note and stop syncing it to Apple Calendar.")
          .addButton((button) => button.setButtonText("Detach").onClick(async () => {
            await this.runDetachAction(CALENDAR_DETACH_CONFIRMATION, "Detach is unavailable. Reopen Calendar and try again.");
          }));
      }
    }
    if (capabilities.showCreateLinkedNote) {
      new Setting(this.contentEl)
        .setName("Create linked vault note")
        .setDesc("Save this read-only calendar event as a linked Markdown note. Apple Calendar will not be modified.")
        .addButton((button) => button.setCta().setButtonText("Create note").onClick(async () => {
          await runCalendarModalAction(this,
            () => this.onSave({ ...this.draft, source: "linked", syncState: "clean" }),
            "Could not create linked note");
        }));
    }
    if (capabilities.showDelete) {
      new Setting(this.contentEl)
        .setName(this.initialSource === "external" ? "Delete from Calendar" : "Delete Calendar copy")
        .setDesc(this.initialSource === "external"
          ? "Permanently remove this event from Apple Calendar."
          : "Remove the Apple Calendar event and keep this note as Vault only.")
        .addButton((button) => {
          button.buttonEl.addClass("mod-warning");
          button.setButtonText("Delete…").onClick(() => {
            this.confirmCalendarDeletion();
          });
        });
    }
    if (capabilities.showDeleteNote) {
      new Setting(this.contentEl)
        .setName("Delete event note")
        .setDesc(this.initialSource === "linked"
          ? "Move this note to Obsidian's trash. OMD Home will not delete or modify Apple Calendar."
          : "Move this event note to Obsidian's trash.")
        .addButton((button) => {
          button.buttonEl.addClass("mod-warning");
          button.setButtonText("Delete note…").onClick(() => this.confirmNoteDeletion());
        });
    }
  }

  private confirmCalendarDeletion(): void {
    if (!this.actions.detachCalendarEvent) {
      new Notice("Delete is unavailable. Reopen calendar and try again.");
      return;
    }
    this.openTrackedModal(new DeleteCalendarEventConfirmationModal(this.app, this.draft, this.initialSource === "linked", async () => {
      try {
        await this.actions.detachCalendarEvent!(this.draft, CALENDAR_EVENT_DELETE_CONFIRMATION);
      } catch (error) {
        if (error instanceof CalendarPartialActionError) this.close();
        throw error;
      }
      new Notice(this.initialSource === "linked"
        ? "Calendar event deleted; note kept as Vault only."
        : "Deleted from Calendar.");
      this.close();
    }));
  }

  private confirmNoteDeletion(): void {
    if (!this.actions.deleteCalendarEventNote) {
      new Notice("Delete is unavailable. Reopen calendar and try again.");
      return;
    }
    this.openTrackedModal(new DeleteEventNoteConfirmationModal(this.app, this.draft, this.initialSource === "linked", async () => {
      await this.actions.deleteCalendarEventNote!(this.draft, CALENDAR_NOTE_DELETE_CONFIRMATION);
      new Notice("Event note moved to trash.");
      this.close();
    }));
  }

  private async recreateCalendarCopy(): Promise<void> {
    if (!calendarRecoveryPresentation(this.draft)?.showRecreate) {
      new Notice("Restore calendar access and retry sync before recreating this event.");
      return;
    }
    const title = this.draft.title.trim();
    if (!title) return void new Notice("Event title is required");
    if (!this.refreshRangeValidation(true)) return;
    const defaultCalendar = this.defaultCalendar;
    if (!defaultCalendar) {
      return void new Notice("Choose a writable default calendar in OMD Home settings first");
    }
    if (!this.actions.recreateCalendarEvent) {
      new Notice("Recreate is unavailable. Reopen the calendar and try again.");
      return;
    }
    this.openTrackedModal(new RecreateCalendarConfirmationModal(this.app, this.draft, defaultCalendar, async () => {
      await this.actions.recreateCalendarEvent!(
        { ...this.draft, title },
        CALENDAR_RECREATE_CONFIRMATION,
        defaultCalendar.id,
        defaultCalendar.selectedCalendarIds,
      );
      this.close();
    }));
  }

  private openTrackedModal<T extends Modal>(modal: T): void {
    if (!this.actions.trackModal) {
      modal.open();
      return;
    }
    this.actions.trackModal(modal)?.open();
  }

  private async retryCalendarSync(): Promise<void> {
    if (!this.actions.synchronizeCalendarEvents) {
      new Notice("Sync is unavailable. Reopen the calendar and try again.");
      return;
    }
    await runCalendarModalAction(this, async () => {
      const summary = await this.actions.synchronizeCalendarEvents!();
      new Notice(calendarSyncResultMessage(summary));
    }, "Could not sync Calendar");
  }

  private async runDetachAction(confirmation: CalendarDetachConfirmation, missingActionMessage: string): Promise<void> {
    if (!this.actions.detachCalendarEvent) {
      new Notice(missingActionMessage);
      return;
    }
    await runCalendarModalAction(this,
      () => this.actions.detachCalendarEvent!(this.draft, confirmation),
      "Could not update Calendar link");
  }

  private async saveDraft(): Promise<void> {
    const blockReason = calendarEditorSaveBlockReason(this.draft);
    if (blockReason) return void new Notice(blockReason);
    const title = this.draft.title.trim();
    if (!title) return void new Notice("Event title is required");
    if (!this.refreshRangeValidation(true)) return;
    if (this.draft.source === "linked" && !this.draft.appleCalendarId && !this.defaultCalendar) {
      return void new Notice("Choose a writable default calendar in OMD Home settings first");
    }
    await runCalendarModalAction(this, () => this.onSave({ ...this.draft, title }), "Could not save event");
  }
}

const pendingCalendarActions = new WeakSet<Modal>();

async function runCalendarModalAction(modal: Modal, action: () => Promise<void>, failureMessage: string): Promise<void> {
  if (calendarModalActionGuards.get(modal)?.() === false) {
    modal.close();
    return;
  }
  if (pendingCalendarActions.has(modal)) return;
  pendingCalendarActions.add(modal);
  const controls = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button"))
    .map((control) => ({ control, disabled: control.disabled }));
  for (const { control } of controls) control.disabled = true;
  modal.contentEl.setAttribute("aria-busy", "true");
  try {
    await action();
    modal.close();
  } catch (error) {
    if (error instanceof CalendarPartialActionError) modal.close();
    new Notice(error instanceof Error ? error.message : failureMessage);
  } finally {
    for (const { control, disabled } of controls) control.disabled = disabled;
    modal.contentEl.removeAttribute("aria-busy");
    pendingCalendarActions.delete(modal);
  }
}

export interface CalendarEditorCapabilities {
  showSave: boolean;
  showDelete: boolean;
  showDeleteNote: boolean;
  showDetach: boolean;
  showDestination: boolean;
  showCreateLinkedNote: boolean;
  showRecreate: boolean;
  showRetrySync: boolean;
}

export function calendarEditorCapabilities(event: CalendarEventRecord): CalendarEditorCapabilities {
  const recoveryLinked = event.source === "linked"
    && (event.syncState === "unavailable" || event.syncState === "error");
  const readOnlyExternal = event.source === "external" && Boolean(event.readOnly);
  const readOnlyLinked = event.source === "linked" && Boolean(event.readOnly);
  const recovery = calendarRecoveryPresentation(event);
  return {
    showSave: !recoveryLinked && !readOnlyExternal && !readOnlyLinked,
    showDelete: Boolean(event.appleItemId)
      && !event.readOnly
      && event.syncState !== "error"
      && event.syncState !== "unavailable",
    showDeleteNote: event.source !== "external" && Boolean(event.notePath),
    showDetach: event.source === "linked" && !isCalendarNoteErrorRecord(event),
    showDestination: !recoveryLinked && !readOnlyExternal && !readOnlyLinked,
    showCreateLinkedNote: readOnlyExternal,
    showRecreate: event.syncState === "unavailable" && Boolean(recovery?.showRecreate),
    showRetrySync: recoveryLinked && Boolean(recovery?.showRetrySync),
  };
}

export function calendarEditorSaveBlockReason(event: CalendarEventRecord): string | undefined {
  if (event.source === "linked" && (event.syncState === "unavailable" || event.syncState === "error")) {
    const recovery = calendarRecoveryPresentation(event);
    if (event.syncState === "error") {
      if (isCalendarNoteErrorRecord(event)) {
        return "Fix the event note and Retry Sync, or Delete event note";
      }
      return event.unavailableReason === "setup-or-read-failure"
        ? "Check Calendar setup and Retry Sync, or Detach the note"
        : "Review the event note and Retry Sync, or Detach the note";
    }
    return recovery?.showRecreate
      ? "Use Retry Sync, Recreate or Detach instead of ordinary Save"
      : "Restore Calendar access and Retry Sync, or Detach the note";
  }
  if (event.source === "external" && event.readOnly) {
    return "This Calendar is read-only. Create a linked vault note instead";
  }
  return undefined;
}

interface WritableDefaultCalendar {
  id: string;
  title: string;
  selectedCalendarIds: readonly string[];
}

interface CalendarDestinationOption {
  value: EventSource;
  label: string;
}

export interface CalendarViewPluginActions {
  synchronizeCalendarEvents?: () => Promise<CalendarSyncSummary>;
  detachCalendarEvent?: (event: CalendarEventRecord, confirmation: CalendarDetachConfirmation) => Promise<void>;
  deleteCalendarEventNote?: (event: CalendarEventRecord, confirmation: CalendarNoteDeleteConfirmation) => Promise<void>;
  recreateCalendarEvent?: (
    event: CalendarEventRecord,
    confirmation: CalendarRecreateConfirmation,
    targetCalendarId: string,
    selectedCalendarIds: readonly string[],
  ) => Promise<void>;
}

interface CalendarEditorActions {
  detachCalendarEvent?: (event: CalendarEventRecord, confirmation: CalendarDetachConfirmation) => Promise<void>;
  deleteCalendarEventNote?: (event: CalendarEventRecord, confirmation: CalendarNoteDeleteConfirmation) => Promise<void>;
  recreateCalendarEvent?: (
    event: CalendarEventRecord,
    confirmation: CalendarRecreateConfirmation,
    targetCalendarId: string,
    selectedCalendarIds: readonly string[],
  ) => Promise<void>;
  synchronizeCalendarEvents?: () => Promise<CalendarSyncSummary>;
  trackModal?: <T extends Modal>(modal: T) => T | null;
}

export function destinationOptions(
  source: EventSource,
  defaultCalendarTitle?: string,
  linkedCalendarTitle?: string,
): CalendarDestinationOption[] {
  const destinationCalendarTitle = source === "linked" ? linkedCalendarTitle : defaultCalendarTitle;
  const linkedLabel = destinationCalendarTitle
    ? `Vault + ${destinationCalendarTitle}`
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

function destinationDescription(source: EventSource, linkedCalendarTitle?: string): string {
  if (source === "external") return "Keep this as a Calendar event, or create a linked note for it.";
  if (source === "linked") {
    const destination = linkedCalendarTitle ?? "its current Calendar";
    return `Save keeps this linked event in ${destination}. Changing the default Calendar does not move it.`;
  }
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
  const selectedCalendarIds = [...new Set(settings.selectedCalendarIds)].sort();
  const defaultCalendar = calendars.find((calendar) => (
    calendar.id === settings.defaultExternalCalendarId
    && calendar.allowsModifications
    && selectedCalendarIds.includes(calendar.id)
  ));
  return defaultCalendar
    ? { id: defaultCalendar.id, title: defaultCalendar.title, selectedCalendarIds }
    : null;
}

function calendarEditorActions(
  plugin: OmdHomePlugin,
  trackModal: <T extends Modal>(modal: T) => T | null,
): CalendarEditorActions {
  const actions = plugin as OmdHomePlugin & CalendarViewPluginActions;
  return {
    detachCalendarEvent: actions.detachCalendarEvent?.bind(plugin),
    deleteCalendarEventNote: actions.deleteCalendarEventNote?.bind(plugin),
    recreateCalendarEvent: actions.recreateCalendarEvent?.bind(plugin),
    synchronizeCalendarEvents: actions.synchronizeCalendarEvents?.bind(plugin),
    trackModal,
  };
}

function toFullCalendarEvent(event: CalendarEventRecord): Record<string, unknown> {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: calendarEventEditable(event),
    extendedProps: {
      source: event.source,
      syncState: event.syncState,
      unavailableReason: event.unavailableReason,
      notePath: event.notePath,
    },
  };
}

export function calendarEventEditable(event: Pick<CalendarEventRecord, "source" | "syncState" | "readOnly">): boolean {
  if (event.readOnly) return false;
  return event.source !== "linked" || !event.syncState || event.syncState === "clean";
}

export function requiresSyncBeforeEdit(
  event: Pick<CalendarEventRecord, "syncState" | "pendingDirection">,
): boolean {
  return event.syncState === "pending" && event.pendingDirection === "external";
}

function sourceFilterButton(
  container: HTMLElement,
  enabledSources: ReadonlySet<EventSource>,
  source: EventSource,
  onClick: () => void,
): void {
  const presentation = eventSourcePresentation(source);
  const button = container.createEl("button", {
    cls: "omd-calendar-filter-button",
    type: "button",
  });
  button.dataset.source = source;
  const marker = button.createSpan({ cls: `omd-source-mark is-${source}` });
  marker.setAttribute("aria-hidden", "true");
  const copy = button.createSpan({ cls: "omd-calendar-source-copy" });
  copy.createSpan({ cls: "omd-calendar-source-label", text: presentation.label });
  copy.createSpan({ cls: "omd-calendar-source-description", text: presentation.description });
  updateSourceFilterButton(button, enabledSources, source);
  button.addEventListener("click", onClick);
}

function updateSourceFilterButton(
  button: HTMLButtonElement,
  enabledSources: ReadonlySet<EventSource>,
  source: EventSource,
): void {
  const state = eventSourceFilterControlState(enabledSources, source);
  button.disabled = false;
  button.setAttribute("aria-disabled", String(state.disabled));
  button.ariaPressed = String(state.enabled);
  button.ariaLabel = state.ariaLabel;
  button.title = state.title;
}
