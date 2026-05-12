/**
 * Inline, non-editable badge representing a slash command inside the composer's
 * contentEditable. Serialization restores it to plain `/<id>` text so the
 * provider pipeline receives the same string the user typed.
 */
export function createSlashCommandChipElement(id: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.slashCommand = id;
  chip.className = "lightcode-slash-chip";

  const slash = document.createElement("span");
  slash.className = "lightcode-slash-chip__slash";
  slash.textContent = "/";
  chip.appendChild(slash);

  const name = document.createElement("span");
  name.className = "lightcode-slash-chip__name";
  name.textContent = id;
  chip.appendChild(name);

  return chip;
}
