/**
 * WorkspaceRouter — opens and switches plugin views.
 * Wraps Obsidian's workspace.getLeaf / setViewState API.
 */

export const DASHBOARD_VIEW_TYPE = "srf-dashboard";
export const REVIEW_VIEW_TYPE = "srf-review";
export const LIBRARY_VIEW_TYPE = "srf-library";

export interface WorkspaceAdapter {
  getLeavesOfType(type: string): { view: { containerEl: HTMLElement } }[];
  getLeaf(newLeaf: boolean): {
    setViewState(state: { type: string; active?: boolean }): Promise<void>;
    view?: { containerEl: HTMLElement };
  };
  revealLeaf(leaf: { view?: { containerEl: HTMLElement } }): void;
}

export class WorkspaceRouter {
  constructor(private workspace: WorkspaceAdapter) {}

  async openDashboard(): Promise<void> {
    await this.openView(DASHBOARD_VIEW_TYPE);
  }

  async openReview(): Promise<void> {
    await this.openView(REVIEW_VIEW_TYPE);
  }

  async openLibrary(): Promise<void> {
    await this.openView(LIBRARY_VIEW_TYPE);
  }

  private async openView(type: string): Promise<void> {
    const existing = this.workspace.getLeavesOfType(type);
    if (existing.length > 0) {
      this.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.workspace.getLeaf(true);
    await leaf.setViewState({ type, active: true });
    this.workspace.revealLeaf(leaf);
  }
}
