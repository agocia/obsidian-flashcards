/**
 * Library filter/search/sort bar.
 */

export interface FilterBarOptions {
  searchValue: string;
  sourceFileValue: string;
  sourceFiles: string[];
  decks: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; label: string }>;
  selectedDeckId: string;
  selectedTagId: string;
  selectedState: string;
  sortBy: string;
  onSearchChange: (value: string) => void;
  onSourceFileChange: (value: string) => void;
  onDeckChange: (id: string) => void;
  onTagChange: (id: string) => void;
  onStateChange: (state: string) => void;
  onSortChange: (sort: string) => void;
}

export function renderFilterBar(container: HTMLElement, opts: FilterBarOptions): HTMLElement {
  const shell = container.createDiv({ cls: "srf-filter-shell" });
  const header = shell.createDiv({ cls: "srf-filter-shell__header" });
  header.createDiv({ cls: "srf-filter-shell__eyebrow", text: "Refine library" });
  header.createDiv({
    cls: "srf-filter-shell__hint",
    text: "Search by prompt, answer, deck, tags, or source note.",
  });

  const grid = shell.createDiv({ cls: "srf-filter-grid" });

  const searchWrap = createField(grid, "Search", "srf-filter-grid__field srf-filter-grid__field--search");
  const searchInputWrap = searchWrap.createDiv({ cls: "srf-filter-bar__search" });
  searchInputWrap.createSpan({ cls: "srf-filter-bar__search-icon", text: "⌕" });
  const searchInput = searchInputWrap.createEl("input", {
    cls: "srf-input srf-filter-bar__search-input",
    type: "text",
  }) as HTMLInputElement;
  searchInput.placeholder = "Search cards";
  searchInput.value = opts.searchValue;
  searchInput.addEventListener("input", () => opts.onSearchChange(searchInput.value));

  const sourceWrap = createField(grid, "Source note", "srf-filter-grid__field");
  const sourceInput = sourceWrap.createEl("input", {
    cls: "srf-input",
    type: "text",
  }) as HTMLInputElement;
  sourceInput.placeholder = "Source note path";
  sourceInput.value = opts.sourceFileValue;
  sourceInput.setAttribute("list", "srf-source-file-options");
  sourceInput.addEventListener("input", () => opts.onSourceFileChange(sourceInput.value));

  const sourceList = sourceWrap.createEl("datalist", { attr: { id: "srf-source-file-options" } });
  opts.sourceFiles.forEach((filePath) => {
    sourceList.createEl("option", { value: filePath });
  });

  createSelectField(grid, "Deck", "All Decks", opts.decks.map((deck) => ({
    value: deck.id,
    label: deck.name,
  })), opts.selectedDeckId, opts.onDeckChange);

  createSelectField(grid, "Tag", "All Tags", opts.tags.map((tag) => ({
    value: tag.id,
    label: tag.label,
  })), opts.selectedTagId, opts.onTagChange);

  createSelectField(
    grid,
    "State",
    "All States",
    [
      { value: "new", label: "New" },
      { value: "learning", label: "Learning" },
      { value: "review", label: "Review" },
      { value: "relearning", label: "Relearning" },
      { value: "suspended", label: "Suspended" },
    ],
    opts.selectedState,
    opts.onStateChange
  );

  createSelectField(
    grid,
    "Sort",
    "Due Date",
    [
      { value: "due", label: "Due Date" },
      { value: "updated", label: "Updated" },
      { value: "deck", label: "Deck" },
      { value: "ease", label: "Ease" },
    ],
    opts.sortBy,
    opts.onSortChange,
    true
  );

  return shell;
}

function createField(
  container: HTMLElement,
  label: string,
  cls = "srf-filter-grid__field"
): HTMLElement {
  const field = container.createDiv({ cls });
  field.createEl("label", { cls: "srf-filter-grid__label", text: label });
  return field;
}

function createSelectField(
  container: HTMLElement,
  label: string,
  emptyLabel: string,
  options: Array<{ value: string; label: string }>,
  selectedValue: string,
  onChange: (value: string) => void,
  omitEmpty = false
): HTMLSelectElement {
  const field = createField(container, label);
  const select = field.createEl("select", { cls: "srf-select" }) as HTMLSelectElement;

  if (!omitEmpty) {
    const emptyOption = select.createEl("option", { value: "", text: emptyLabel });
    if (!selectedValue) emptyOption.selected = true;
  }

  options.forEach((option) => {
    const opt = select.createEl("option", { value: option.value, text: option.label });
    if (option.value === selectedValue) opt.selected = true;
  });

  select.addEventListener("change", () => onChange(select.value));
  return select;
}
