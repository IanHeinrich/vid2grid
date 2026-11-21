import { deletePersona, listPersonas, savePersona, type Persona } from "../chat/personas";
import type { AppElements } from "../dom";
import { listenToPersonaFields, renderPersonaFields, setUnlessFocused } from "./personaFields";
import { offerUndo, type Toast } from "./toast";

export interface PresetManager {
  open(options?: { presetId?: string | undefined; focusName?: boolean }): void;
}

export interface PresetManagerDeps {
  toast: Toast;
  storage: Storage;
  onApply(persona: Persona): void;
  onChanged(): void;
}

interface PresetManagerContext {
  els: AppElements["presetManager"];
  deps: PresetManagerDeps;
  selectedId: string;
}

export function initPresetManager(
  els: Pick<AppElements, "presetManager">,
  deps: PresetManagerDeps,
): PresetManager {
  const ctx: PresetManagerContext = { els: els.presetManager, deps, selectedId: "" };
  listenToList(ctx);
  listenToEditor(ctx);
  return {
    open: ({ presetId, focusName = false } = {}) => {
      ctx.selectedId = presetId ?? ctx.selectedId;
      render(ctx);
      ctx.els.dialog.showModal();
      if (focusName) focusNameInput(ctx);
    },
  };
}

function personas(ctx: PresetManagerContext): Persona[] {
  return listPersonas(ctx.deps.storage);
}

function selected(ctx: PresetManagerContext): Persona | undefined {
  return personas(ctx).find((persona) => persona.id === ctx.selectedId);
}

function focusNameInput(ctx: PresetManagerContext): void {
  ctx.els.nameInput.focus();
  ctx.els.nameInput.select();
}

function listenToList(ctx: PresetManagerContext): void {
  const { els } = ctx;
  els.list.addEventListener("click", (event) => {
    const item = event.target instanceof Element ? event.target.closest("[data-id]") : null;
    if (!(item instanceof HTMLElement) || item.dataset.id === undefined) return;
    ctx.selectedId = item.dataset.id;
    render(ctx);
  });
  els.newButton.addEventListener("click", () =>
    add(ctx, { id: crypto.randomUUID(), name: "New preset", systemPrompt: "" }),
  );
  els.duplicateButton.addEventListener("click", () => {
    const persona = selected(ctx);
    if (persona) add(ctx, { ...persona, id: crypto.randomUUID(), name: `${persona.name} copy` });
  });
  els.deleteButton.addEventListener("click", () => remove(ctx));
  els.applyButton.addEventListener("click", () => {
    const persona = selected(ctx);
    if (!persona) return;
    // Closed first, so the apply's undo toast lands outside the modal where it can be reached.
    els.dialog.close();
    ctx.deps.onApply(persona);
  });
}

function add(ctx: PresetManagerContext, persona: Persona): void {
  savePersona(persona, ctx.deps.storage);
  ctx.selectedId = persona.id;
  changed(ctx);
  focusNameInput(ctx);
}

function remove(ctx: PresetManagerContext): void {
  const all = personas(ctx);
  const index = all.findIndex((persona) => persona.id === ctx.selectedId);
  const persona = all[index];
  if (!persona) return;
  deletePersona(persona.id, ctx.deps.storage);
  ctx.selectedId = (all[index + 1] ?? all[index - 1])?.id ?? "";
  changed(ctx);
  offerUndo(ctx.deps.toast, `Deleted preset ${persona.name}`, {
    undo: () => {
      savePersona(persona, ctx.deps.storage);
      ctx.selectedId = persona.id;
      changed(ctx);
    },
  });
}

function listenToEditor(ctx: PresetManagerContext): void {
  const { els } = ctx;
  els.nameInput.addEventListener("change", () => {
    const name = els.nameInput.value.trim();
    edit(ctx, (persona) => ({ ...persona, name: name || persona.name }));
  });
  listenToPersonaFields(els, (change) => edit(ctx, change));
}

function edit(ctx: PresetManagerContext, change: (persona: Persona) => Persona): void {
  const persona = selected(ctx);
  if (!persona) return;
  savePersona(change(persona), ctx.deps.storage);
  changed(ctx);
}

function changed(ctx: PresetManagerContext): void {
  render(ctx);
  ctx.deps.onChanged();
}

function render(ctx: PresetManagerContext): void {
  const { els } = ctx;
  const all = personas(ctx);
  const persona = all.find((entry) => entry.id === ctx.selectedId) ?? all[0];
  ctx.selectedId = persona?.id ?? "";
  els.list.replaceChildren(...all.map((entry) => listItem(entry, entry === persona)));
  els.empty.hidden = all.length > 0;
  els.editor.hidden = !persona;
  els.duplicateButton.disabled = !persona;
  els.deleteButton.disabled = !persona;
  els.applyButton.disabled = !persona;
  if (persona) renderEditor(els, persona);
}

function listItem(persona: Persona, current: boolean): HTMLLIElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "preset-item";
  button.dataset.id = persona.id;
  button.textContent = persona.name;
  if (current) button.setAttribute("aria-current", "true");
  const item = document.createElement("li");
  item.append(button);
  return item;
}

function renderEditor(els: AppElements["presetManager"], persona: Persona): void {
  setUnlessFocused(els.nameInput, persona.name);
  renderPersonaFields(els, persona);
}
