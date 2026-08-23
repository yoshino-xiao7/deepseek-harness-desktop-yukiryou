import {
  COMPANION_PANEL_WIDTH,
  normalizedCompanionPanelWidth,
  type DesktopCompanionSnapshot,
} from '../shared/desktop-companion.js';
import type {
  WorkspaceNode,
  WorkspaceReviewRequest,
  WorkspaceReviewResponse,
} from '../shared/workspace-review.js';
import { structuredDiffRows } from './diff-model.js';
import {
  companionPanelDragDecision,
  companionPanelWidthFromKey,
  companionPanelWidthFromPointer,
} from './companion-panel-resize.js';
import {
  parseSafeMarkdown,
  type SafeMarkdownInline,
} from './safe-markdown.js';
import { startupFailureCopy } from './startup-failure-copy.js';
import {
  createWorkspaceReviewController,
  type WorkspaceChangeScope,
  type WorkspaceReviewSnapshot,
} from './workspace-review-controller.js';
import {
  type WorkspaceReviewShortcut,
  workspaceReviewShortcut,
} from '../shared/workspace-review-shortcuts.js';
import {
  type WorkspaceConversationReference,
  workspaceConversationInsertion,
  workspaceConversationReferenceText,
} from '../shared/workspace-conversation-reference.js';

const parameters = new URLSearchParams(window.location.search);
const failed = parameters.get('state') === 'failure';
const status = document.querySelector<HTMLElement>('[data-testid="startup-status"]');
const companionToggle = document.querySelector<HTMLButtonElement>('[data-testid="companion-toggle"]');
const companionPanel = document.querySelector<HTMLElement>('[data-testid="companion-panel"]');
const companionResizer = document.querySelector<HTMLElement>('[data-testid="companion-resizer"]');
const companionTitle = document.querySelector<HTMLElement>('[data-testid="companion-workspace-title"]');
const companionRunning = document.querySelector<HTMLElement>('[data-testid="companion-running"]');
const companionEmpty = document.querySelector<HTMLElement>('[data-testid="companion-empty"]');
const reviewBrowser = document.querySelector<HTMLElement>('[data-testid="review-browser"]');
const changesView = document.querySelector<HTMLElement>('[data-review-view="changes"]');
const filesView = document.querySelector<HTMLElement>('[data-review-view="files"]');
const changeCount = document.querySelector<HTMLElement>('[data-testid="change-count"]');
const reviewNote = document.querySelector<HTMLElement>('[data-testid="review-note"]');
const reviewSearch = document.querySelector<HTMLInputElement>('[data-testid="review-search"]');
const changeFilter = document.querySelector<HTMLSelectElement>('[data-testid="change-filter"]');
const previewPanel = document.querySelector<HTMLElement>('[data-testid="preview-panel"]');
const previewName = document.querySelector<HTMLElement>('[data-testid="preview-name"]');
const previewPath = document.querySelector<HTMLElement>('[data-testid="preview-path"]');
const previewContent = document.querySelector<HTMLElement>('[data-testid="preview-content"]');
const previewMode = document.querySelector<HTMLButtonElement>('[data-testid="preview-mode"]');
const previewBack = document.querySelector<HTMLButtonElement>('[data-testid="preview-back"]');
const previewForward = document.querySelector<HTMLButtonElement>('[data-testid="preview-forward"]');
const previewFindToggle = document.querySelector<HTMLButtonElement>('[data-testid="preview-find-toggle"]');
const previewFindBar = document.querySelector<HTMLElement>('[data-testid="preview-find-bar"]');
const previewFindInput = document.querySelector<HTMLInputElement>('[data-testid="preview-find-input"]');
const previewFindProgress = document.querySelector<HTMLElement>('[data-testid="preview-find-progress"]');
const previewFindPrevious = document.querySelector<HTMLButtonElement>('[data-testid="preview-find-previous"]');
const previewFindNext = document.querySelector<HTMLButtonElement>('[data-testid="preview-find-next"]');
const previewCopyMenu = document.querySelector<HTMLDetailsElement>('[data-testid="preview-copy-menu"]');
const previewCopyFeedback = document.querySelector<HTMLElement>('[data-testid="preview-copy-feedback"]');
const reviewBar = document.querySelector<HTMLElement>('[data-testid="preview-review-bar"]');
const reviewProgress = document.querySelector<HTMLElement>('[data-testid="review-progress"]');
const reviewPrevious = document.querySelector<HTMLButtonElement>('[data-testid="review-previous"]');
const reviewNext = document.querySelector<HTMLButtonElement>('[data-testid="review-next"]');
const reviewToggleViewed = document.querySelector<HTMLButtonElement>('[data-testid="review-toggle-viewed"]');
let loadedWorkspaceId: string | undefined;
let reviewLoadRevision = 0;
let currentPreview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined;
let showingMarkdownSource = false;
let searchRevision = 0;
let searchTimer: number | undefined;
let overviewNote = '';
let latestCompanionSnapshot: DesktopCompanionSnapshot | undefined;
let workspaceLossTimer: number | undefined;
let copyFeedbackTimer: number | undefined;
let workspaceContextMenu: HTMLElement | undefined;
let referenceFeedbackTimer: number | undefined;
const reviewController = createWorkspaceReviewController();
const companionPanelWidthStorageKey = 'dsh.desktop.companion.panel-width';
const companionBridge = (
  window as unknown as {
    deepSeekYukiRyouCompanion?: {
      getSnapshot(): DesktopCompanionSnapshot;
      subscribe(listener: (snapshot: DesktopCompanionSnapshot) => void): () => void;
      subscribeShortcut(listener: (shortcut: WorkspaceReviewShortcut) => void): () => void;
      toggle(): void;
      setPreviewOpen(open: boolean): void;
      resize(width: number): void;
      writeClipboard(text: string): boolean;
      addToConversation(reference: WorkspaceConversationReference): boolean;
      request(request: WorkspaceReviewRequest): Promise<WorkspaceReviewResponse>;
      subscribeReviewTarget(listener: (preview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined) => void): () => void;
    };
  }
).deepSeekYukiRyouCompanion;
const windowBridge = (
  window as unknown as {
    deepSeekYukiRyouWindow?: {
      platform: string;
      openMenu(request: { id: 'file' | 'edit' | 'view' | 'help'; x: number; y: number }): boolean;
    };
  }
).deepSeekYukiRyouWindow;

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-window-menu]')) {
  button.addEventListener('click', () => {
    const id = button.dataset.windowMenu;
    if (id !== 'file' && id !== 'edit' && id !== 'view' && id !== 'help') return;
    const bounds = button.getBoundingClientRect();
    windowBridge?.openMenu({ id, x: bounds.left, y: bounds.bottom });
  });
}

function applyCompanionPanelWidth(width: number, persist = true): number {
  const normalized = normalizedCompanionPanelWidth(width);
  document.documentElement.style.setProperty('--companion-panel-width', `${String(normalized)}px`);
  companionResizer?.setAttribute('aria-valuenow', String(normalized));
  if (persist) localStorage.setItem(companionPanelWidthStorageKey, String(normalized));
  return normalized;
}

function restoredCompanionPanelWidth(): number | undefined {
  const stored = Number(localStorage.getItem(companionPanelWidthStorageKey));
  return Number.isFinite(stored) && stored > 0
    ? normalizedCompanionPanelWidth(stored)
    : undefined;
}

function renderCompanion(snapshot: DesktopCompanionSnapshot): void {
  latestCompanionSnapshot = snapshot;
  applyCompanionPanelWidth(snapshot.panelWidth);
  document.body.dataset.companionActive = String(snapshot.active);
  document.body.dataset.companionOpen = String(snapshot.active && snapshot.open);
  if (companionToggle !== null) {
    companionToggle.hidden = !snapshot.active;
    companionToggle.setAttribute('aria-expanded', String(snapshot.open));
  }
  if (companionPanel !== null) {
    companionPanel.hidden = !snapshot.active;
    companionPanel.setAttribute('aria-hidden', String(!snapshot.open));
  }
  if (previewPanel !== null) previewPanel.hidden = !snapshot.active || !snapshot.previewOpen;
  const workspace = snapshot.workspace;
  if (companionTitle !== null) {
    companionTitle.textContent = workspace.status === 'ready'
      ? workspace.title
      : workspace.status === 'authorizing'
        ? '正在确认工作区…'
        : '当前工作区';
  }
  const running = workspace.status !== 'none' && workspace.running;
  if (companionRunning !== null) companionRunning.hidden = !running;
  if (companionEmpty !== null) {
    const heading = companionEmpty.querySelector('strong');
    const detail = companionEmpty.querySelector('small');
    if (workspace.status === 'ready') {
      if (heading !== null) heading.textContent = '正在读取工作区';
      if (detail !== null) detail.textContent = '文件与变更会在准备完成后显示';
    } else if (workspace.status === 'unavailable') {
      if (heading !== null) heading.textContent = '无法确认当前工作区';
      if (detail !== null) detail.textContent = 'Harness 仍可正常使用，请切换会话后重试';
    } else {
      if (heading !== null) heading.textContent = '选择一个工作区会话';
      if (detail !== null) detail.textContent = '文件、变更与预览会显示在这里';
    }
  }
  if (workspace.status === 'ready') {
    if (workspaceLossTimer !== undefined) {
      window.clearTimeout(workspaceLossTimer);
      workspaceLossTimer = undefined;
    }
    if (workspace.workspaceId !== loadedWorkspaceId) {
      loadedWorkspaceId = workspace.workspaceId;
      applyReviewSnapshot(reviewController.execute({
        kind: 'workspace.select', workspaceId: workspace.workspaceId,
      }).snapshot);
      void loadOverview(workspace.workspaceId);
    }
  } else {
    const preserveReviewSurface = loadedWorkspaceId !== undefined || workspaceLossTimer !== undefined;
    loadedWorkspaceId = undefined;
    const suspended = reviewController.execute({
      kind: 'workspace.select', workspaceId: undefined,
    }).snapshot;
    applyReviewSnapshot(suspended);
    if (preserveReviewSurface && snapshot.active) {
      syncReviewControls(suspended);
      changesView?.replaceChildren(createEmptyRow('正在重新确认工作区…'));
      filesView?.replaceChildren(createEmptyRow('正在重新确认工作区…'));
      if (reviewNote !== null) reviewNote.textContent = '文件能力已暂时释放，正在重新连接。';
      if (reviewBrowser !== null) reviewBrowser.hidden = false;
      if (companionEmpty !== null) companionEmpty.hidden = true;
      if (workspaceLossTimer === undefined) {
        workspaceLossTimer = window.setTimeout(() => {
          workspaceLossTimer = undefined;
          if (latestCompanionSnapshot?.workspace.status === 'ready') return;
          if (reviewBrowser !== null) reviewBrowser.hidden = true;
          if (companionEmpty !== null) companionEmpty.hidden = false;
        }, 1_500);
      }
    } else {
      if (reviewBrowser !== null) reviewBrowser.hidden = true;
      if (companionEmpty !== null) companionEmpty.hidden = false;
    }
    closePreview();
  }
}

if (companionBridge !== undefined) {
  const initialSnapshot = companionBridge.getSnapshot();
  const restoredWidth = restoredCompanionPanelWidth();
  if (restoredWidth !== undefined && restoredWidth !== initialSnapshot.panelWidth) {
    companionBridge.resize(restoredWidth);
  }
  renderCompanion({
    ...initialSnapshot,
    panelWidth: restoredWidth ?? initialSnapshot.panelWidth,
  });
  companionBridge.subscribe(renderCompanion);
  companionBridge.subscribeShortcut(handleWorkspaceReviewShortcut);
  companionBridge.subscribeReviewTarget((preview) => {
    if (preview === undefined) {
      applyReviewSnapshot(reviewController.execute({ kind: 'preview.clear' }).snapshot);
      return;
    }
    applyReviewSnapshot(reviewController.execute({ kind: 'preview.visit', preview }).snapshot);
  });
  companionToggle?.addEventListener('click', () => companionBridge.toggle());

  let activePanelPointerId: number | undefined;
  const resizePanel = (width: number): void => {
    const normalized = applyCompanionPanelWidth(width);
    companionBridge.resize(normalized);
  };
  companionResizer?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || activePanelPointerId !== undefined) return;
    activePanelPointerId = event.pointerId;
    document.body.dataset.companionResizing = 'true';
    companionResizer.setPointerCapture(event.pointerId);
    resizePanel(companionPanelWidthFromPointer(window.innerWidth, event.clientX));
  });
  companionResizer?.addEventListener('pointermove', (event) => {
    const decision = companionPanelDragDecision(
      activePanelPointerId,
      event.pointerId,
      event.buttons,
    );
    if (decision === 'ignore') return;
    if (decision === 'finish') {
      finishPanelResize(event.pointerId);
      return;
    }
    resizePanel(companionPanelWidthFromPointer(window.innerWidth, event.clientX));
  });
  const finishPanelResize = (pointerId = activePanelPointerId): void => {
    if (pointerId === undefined || pointerId !== activePanelPointerId) return;
    activePanelPointerId = undefined;
    delete document.body.dataset.companionResizing;
    if (companionResizer?.hasPointerCapture(pointerId) === true) {
      companionResizer.releasePointerCapture(pointerId);
    }
  };
  companionResizer?.addEventListener('pointerup', (event) => finishPanelResize(event.pointerId));
  companionResizer?.addEventListener('pointercancel', (event) => finishPanelResize(event.pointerId));
  companionResizer?.addEventListener('lostpointercapture', (event) => finishPanelResize(event.pointerId));
  window.addEventListener('blur', () => finishPanelResize());
  companionResizer?.addEventListener('keydown', (event) => {
    const currentWidth = Number.parseFloat(
      document.documentElement.style.getPropertyValue('--companion-panel-width'),
    ) || COMPANION_PANEL_WIDTH;
    const width = companionPanelWidthFromKey(currentWidth, event.key, event.shiftKey);
    if (width === undefined) return;
    event.preventDefault();
    resizePanel(width);
  });
}

async function loadOverview(workspaceId: string): Promise<void> {
  if (companionBridge === undefined) return;
  const revision = ++reviewLoadRevision;
  setReviewLoading(true);
  const response = await companionBridge.request({ kind: 'overview' });
  if (revision !== reviewLoadRevision || loadedWorkspaceId !== workspaceId) return;
  setReviewLoading(false);
  if (response.kind !== 'overview') {
    if (reviewNote !== null) reviewNote.textContent = '暂时无法读取工作区，请稍后刷新。';
    return;
  }
  const reviewSnapshot = reviewController.execute({ kind: 'overview.replace', overview: response }).snapshot;
  overviewNote = response.truncated
    ? '内容较多，仅显示前一部分。'
    : response.gitAvailable
      ? '只读视图 · 相对 HEAD 的当前工作区变更'
      : '此目录不是 Git 工作区，仍可浏览文件。';
  if (companionEmpty !== null) companionEmpty.hidden = true;
  if (reviewBrowser !== null) reviewBrowser.hidden = false;
  renderReviewSnapshot(reviewSnapshot);
  setReviewSelection(currentPreview?.nodeId);
  if (reviewNote !== null) reviewNote.textContent = overviewNote;
}

function setReviewLoading(loading: boolean): void {
  const refresh = document.querySelector<HTMLButtonElement>('[data-testid="review-refresh"]');
  if (refresh !== null) refresh.disabled = loading;
}

function renderChanges(snapshot: WorkspaceReviewSnapshot): void {
  if (changesView === null) return;
  changesView.replaceChildren();
  const response = snapshot.overview;
  if (response === undefined) return;
  const changes = snapshot.visibleChanges;
  const scope = snapshot.scope;
  const filtering = (reviewSearch?.value.trim() ?? '') !== '' || scope !== 'all';
  if (changeCount !== null) {
    changeCount.textContent = filtering
      ? `${String(changes.length)}/${String(response.changes.length)}`
      : String(response.changes.length);
  }
  if (changes.length === 0) {
    changesView.append(createEmptyRow(response.gitAvailable ? '当前没有未提交变更' : 'Git 变更不可用'));
    if (filtering && response.changes.length > 0) {
      changesView.replaceChildren(createEmptyRow('没有匹配的变更'));
    }
    return;
  }
  const tree = createChangeTree(changes);
  appendChangeTree(changesView, tree, 0, new Set(snapshot.review.viewedNodeIds));
  setReviewSelection(snapshot.preview?.nodeId);
}

interface ChangeTree {
  readonly directories: Map<string, ChangeTree>;
  readonly changes: Extract<WorkspaceReviewResponse, {kind:'overview'}>['changes'][number][];
}

function createChangeTree(changes: Extract<WorkspaceReviewResponse, {kind:'overview'}>['changes']): ChangeTree {
  const root: ChangeTree = { directories: new Map(), changes: [] };
  for (const change of changes) {
    const parts = change.path.split('/');
    let branch = root;
    for (const directory of parts.slice(0, -1)) {
      let child = branch.directories.get(directory);
      if (child === undefined) {
        child = { directories: new Map(), changes: [] };
        branch.directories.set(directory, child);
      }
      branch = child;
    }
    branch.changes.push(change);
  }
  return root;
}

function appendChangeTree(parent: HTMLElement, tree: ChangeTree, depth: number, viewed: ReadonlySet<string>): void {
  for (const [name, child] of tree.directories) {
    const group = document.createElement('div');
    group.className = 'change-directory-group';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'change-directory';
    row.style.setProperty('--tree-depth', String(depth));
    row.setAttribute('aria-expanded', 'true');
    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = name;
    row.append(chevron, label);
    const children = document.createElement('div');
    children.className = 'change-directory-children';
    appendChangeTree(children, child, depth + 1, viewed);
    row.addEventListener('click', () => {
      const expanded = row.getAttribute('aria-expanded') === 'true';
      row.setAttribute('aria-expanded', String(!expanded));
      children.hidden = expanded;
    });
    group.append(row, children);
    parent.append(group);
  }
  for (const change of tree.changes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'change-row';
    button.style.setProperty('--tree-depth', String(depth));
    if (change.nodeId !== undefined) button.dataset.nodeId = change.nodeId;
    if (change.nodeId !== undefined && viewed.has(change.nodeId)) button.dataset.reviewed = 'true';
    button.disabled = change.nodeId === undefined;
    const badge = document.createElement('span');
    badge.className = `change-badge status-${change.status}`;
    badge.textContent = statusLabel(change.status);
    const path = document.createElement('span');
    path.className = 'change-path';
    path.textContent = change.path.split('/').at(-1) ?? change.path;
    path.title = change.path;
    const stats = document.createElement('small');
    stats.className = 'change-stats';
    stats.textContent = change.additions === undefined ? '' : `+${String(change.additions)} −${String(change.deletions ?? 0)}`;
    const reviewed = document.createElement('span');
    reviewed.className = 'change-reviewed';
    reviewed.textContent = '✓';
    reviewed.setAttribute('aria-label', '已查看');
    reviewed.hidden = button.dataset.reviewed !== 'true';
    button.append(badge, path, reviewed, stats);
    if (change.nodeId !== undefined) {
      button.addEventListener('click', () => void openDiff(change.nodeId!));
      installPathReferenceInteractions(button, change.path, 'file');
    }
    parent.append(button);
  }
}

function renderFileTree(nodes: readonly WorkspaceNode[]): void {
  if (filesView === null) return;
  filesView.replaceChildren();
  if (nodes.length === 0) {
    filesView.append(createEmptyRow('工作区中没有可预览文件'));
    return;
  }
  for (const node of nodes) filesView.append(createNodeRow(node, 0, ''));
}

function renderSearchResults(
  response: Extract<WorkspaceReviewResponse, { kind: 'search' }>,
): void {
  if (filesView === null) return;
  filesView.replaceChildren();
  if (response.nodes.length === 0) {
    filesView.append(createEmptyRow('没有匹配的文件'));
    return;
  }
  for (const node of response.nodes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-row search-result';
    button.dataset.nodeId = node.id;
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = fileIcon(node.extension);
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'search-result-copy';
    const name = document.createElement('strong');
    name.textContent = node.name;
    const path = document.createElement('small');
    path.textContent = node.path;
    copy.append(name, path);
    button.append(icon, copy);
    button.addEventListener('click', () => void openPreview(node.id));
    installPathReferenceInteractions(button, node.path, 'file');
    filesView.append(button);
  }
}

function validatedChangeScope(value: string | undefined): WorkspaceChangeScope {
  return value === 'staged' || value === 'unstaged' || value === 'added'
    || value === 'modified' || value === 'deleted' || value === 'conflicted'
    ? value
    : 'all';
}

function applyReviewQuery(): void {
  const snapshot = reviewController.getSnapshot();
  syncReviewProgress(snapshot);
  const overview = snapshot.overview;
  if (overview === undefined) return;
  if (snapshot.tab === 'changes') {
    if (reviewNote !== null) reviewNote.textContent = overviewNote;
    renderChanges(snapshot);
    return;
  }
  const query = snapshot.query.trim();
  if (query === '') {
    searchRevision += 1;
    renderFileTree(overview.nodes);
    if (reviewNote !== null) reviewNote.textContent = overviewNote;
    return;
  }
  void searchFiles(query);
}

async function searchFiles(query: string): Promise<void> {
  if (companionBridge === undefined || filesView === null) return;
  const revision = ++searchRevision;
  filesView.replaceChildren(createEmptyRow('正在搜索文件…'));
  const response = await companionBridge.request({ kind: 'file.search', query });
  if (
    revision !== searchRevision || reviewController.getSnapshot().tab !== 'files'
    || query !== reviewController.getSnapshot().query.trim()
  ) return;
  if (response.kind !== 'search') {
    filesView.replaceChildren(createEmptyRow('文件搜索暂时不可用'));
    if (reviewNote !== null) reviewNote.textContent = '搜索失败，请稍后重试。';
    return;
  }
  renderSearchResults(response);
  if (reviewNote !== null) {
    reviewNote.textContent = response.truncated
      ? '搜索结果较多，仅显示前 100 条。'
      : `找到 ${String(response.nodes.length)} 个文件`;
  }
}

function scheduleReviewQuery(): void {
  const snapshot = reviewController.execute({
    kind: 'query.change', query: reviewSearch?.value ?? '',
  }).snapshot;
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  if (snapshot.tab === 'changes') {
    applyReviewQuery();
    return;
  }
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    applyReviewQuery();
  }, 180);
}

function createNodeRow(node: WorkspaceNode, depth: number, parentPath: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-row';
  button.style.setProperty('--tree-depth', String(depth));
  button.dataset.nodeId = node.id;
  const relativePath = parentPath === '' ? node.name : `${parentPath}/${node.name}`;
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = node.kind === 'directory' ? '' : fileIcon(node.extension);
  if (node.kind === 'directory') {
    icon.className = 'tree-chevron';
  }
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = node.name;
  button.append(icon, name);
  wrapper.append(button);
  if (node.kind === 'file') {
    button.addEventListener('click', () => void openPreview(node.id));
    installPathReferenceInteractions(button, relativePath, 'file');
  } else {
    button.setAttribute('aria-expanded', 'false');
    installPathReferenceInteractions(button, relativePath, 'directory');
    button.addEventListener('click', () => void toggleDirectory(wrapper, button, node, depth, relativePath));
  }
  return wrapper;
}

async function toggleDirectory(wrapper: HTMLElement, button: HTMLButtonElement, node: WorkspaceNode, depth: number, relativePath: string): Promise<void> {
  const existing = wrapper.querySelector<HTMLElement>(':scope > .tree-children');
  if (existing !== null) {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    existing.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    return;
  }
  if (companionBridge === undefined) return;
  button.disabled = true;
  const response = await companionBridge.request({ kind: 'directory.list', nodeId: node.id });
  button.disabled = false;
  if (response.kind !== 'directory') return;
  const children = document.createElement('div');
  children.className = 'tree-children';
  for (const child of response.nodes) children.append(createNodeRow(child, depth + 1, relativePath));
  wrapper.append(children);
  button.setAttribute('aria-expanded', 'true');
}

async function openPreview(nodeId: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'file.preview', nodeId });
  if (response.kind !== 'preview') return;
  companionBridge.setPreviewOpen(true);
  applyReviewSnapshot(reviewController.execute({ kind: 'preview.visit', preview: response }).snapshot);
}

async function openRelativePreview(nodeId: string, target: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'file.preview-relative', nodeId, target });
  if (response.kind !== 'preview') return;
  companionBridge.setPreviewOpen(true);
  applyReviewSnapshot(reviewController.execute({ kind: 'preview.visit', preview: response }).snapshot);
}

async function openDiff(nodeId: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'change.diff', nodeId });
  if (response.kind !== 'preview') return;
  companionBridge.setPreviewOpen(true);
  applyReviewSnapshot(reviewController.execute({ kind: 'preview.visit', preview: response }).snapshot);
}

function applyReviewSnapshot(snapshot: WorkspaceReviewSnapshot): void {
  syncReviewControls(snapshot);
  currentPreview = snapshot.preview;
  showingMarkdownSource = false;
  if (previewBack !== null) previewBack.disabled = !snapshot.canBack;
  if (previewForward !== null) previewForward.disabled = !snapshot.canForward;
  syncReviewProgress(snapshot);
  syncPreviewFindControls(snapshot);
  syncPreviewCopyControls(snapshot);
  setReviewSelection(snapshot.preview?.nodeId);
  if (snapshot.preview === undefined) {
    previewContent?.replaceChildren();
    return;
  }
  companionBridge?.setPreviewOpen(true);
  renderPreview(snapshot.find.open && snapshot.find.query !== '');
}

function syncPreviewCopyControls(snapshot: WorkspaceReviewSnapshot): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-target="line"], [data-copy-target="path-line"]')) {
    button.disabled = snapshot.selectedLine === undefined;
  }
  for (const row of previewContent?.querySelectorAll<HTMLElement>('.text-row, .diff-row') ?? []) {
    row.removeAttribute('data-selected');
  }
  if (snapshot.selectedLineKey === undefined) return;
  const lineButton = [...(previewContent?.querySelectorAll<HTMLButtonElement>('[data-line-key]') ?? [])]
    .find((button) => button.dataset.lineKey === snapshot.selectedLineKey);
  lineButton?.closest<HTMLElement>('.text-row, .diff-row')?.setAttribute('data-selected', 'true');
}

function selectPreviewLine(line: number, key: string): void {
  const snapshot = reviewController.execute({ kind: 'line.select', line, key }).snapshot;
  syncPreviewCopyControls(snapshot);
}

function copyPreviewTarget(target: 'path' | 'line' | 'path-line'): void {
  const transition = reviewController.execute({ kind: 'copy.request', target });
  if (transition.effect?.kind !== 'copy-text') return;
  if (companionBridge?.writeClipboard(transition.effect.text) !== true) return;
  if (previewCopyMenu !== null) previewCopyMenu.open = false;
  if (previewCopyFeedback !== null) {
    previewCopyFeedback.textContent = `已复制${transition.effect.label}`;
    previewCopyFeedback.hidden = false;
    if (copyFeedbackTimer !== undefined) window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
      copyFeedbackTimer = undefined;
      previewCopyFeedback.hidden = true;
    }, 1_200);
  }
}

interface WorkspaceContextAction {
  readonly label: string;
  readonly run: () => void;
}

function conversationReferenceTarget(): {
  readonly sessionId: string;
  readonly workspaceId: string;
} | undefined {
  const workspace = latestCompanionSnapshot?.workspace;
  return workspace?.status === 'ready'
    ? { sessionId: workspace.sessionId, workspaceId: workspace.workspaceId }
    : undefined;
}

function pathConversationReference(
  path: string,
  kind: 'file' | 'directory',
): WorkspaceConversationReference | undefined {
  const target = conversationReferenceTarget();
  return target === undefined ? undefined : { kind, ...target, path };
}

function addReferenceToConversation(reference: WorkspaceConversationReference): void {
  if (companionBridge?.addToConversation(reference) !== true) {
    showReferenceFeedback('当前没有可用的对话');
    return;
  }
  showReferenceFeedback(
    reference.kind === 'file'
      ? '已添加文件到对话'
      : reference.kind === 'directory'
        ? '已添加文件夹到对话'
        : '已添加选中内容到对话',
  );
}

function installPathReferenceInteractions(
  element: HTMLElement,
  path: string,
  kind: 'file' | 'directory',
): void {
  element.draggable = true;
  element.addEventListener('dragstart', (event) => {
    const reference = pathConversationReference(path, kind);
    if (reference === undefined || event.dataTransfer === null) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', workspaceConversationReferenceText(reference));
    event.dataTransfer.setData(
      'application/x-deepseek-workspace-reference',
      JSON.stringify(workspaceConversationInsertion(reference)),
    );
    element.dataset.dragging = 'true';
  });
  element.addEventListener('dragend', () => delete element.dataset.dragging);
  element.addEventListener('contextmenu', (event) => {
    const reference = pathConversationReference(path, kind);
    if (reference === undefined) return;
    event.preventDefault();
    showWorkspaceContextMenu(event.clientX, event.clientY, [
      {
        label: kind === 'directory' ? '添加文件夹到对话' : '添加到对话',
        run: () => addReferenceToConversation(reference),
      },
      { label: '复制相对路径', run: () => copyPlainText(path, '已复制相对路径') },
    ]);
  });
}

function previewSelectionReference(): Extract<
  WorkspaceConversationReference,
  { kind: 'selection' }
> | undefined {
  const preview = currentPreview;
  const target = conversationReferenceTarget();
  const selection = window.getSelection();
  if (
    preview === undefined || target === undefined || selection === null ||
    selection.rangeCount === 0 || selection.isCollapsed || previewContent === null
  ) return undefined;
  const range = selection.getRangeAt(0);
  if (!previewContent.contains(range.commonAncestorContainer)) return undefined;
  const text = selection.toString();
  if (text.trim() === '') return undefined;
  const lines = [...previewContent.querySelectorAll<HTMLElement>('[data-reference-line]')]
    .filter((row) => {
      try {
        return range.intersectsNode(row);
      } catch {
        return false;
      }
    })
    .map((row) => Number(row.dataset.referenceLine))
    .filter((line) => Number.isSafeInteger(line) && line > 0);
  return {
    kind: 'selection',
    ...target,
    path: preview.path,
    text,
    ...(lines.length === 0 ? {} : {
      startLine: Math.min(...lines),
      endLine: Math.max(...lines),
    }),
  };
}

function selectedLineReference(row: HTMLElement): Extract<
  WorkspaceConversationReference,
  { kind: 'selection' }
> | undefined {
  const preview = currentPreview;
  const target = conversationReferenceTarget();
  const line = Number(row.dataset.referenceLine);
  const code = row.querySelector<HTMLElement>('.text-line-code, .diff-code')?.textContent;
  if (
    preview === undefined || target === undefined || !Number.isSafeInteger(line) ||
    line <= 0 || code === undefined
  ) return undefined;
  return {
    kind: 'selection',
    ...target,
    path: preview.path,
    text: code,
    startLine: line,
    endLine: line,
  };
}

function showWorkspaceContextMenu(
  clientX: number,
  clientY: number,
  actions: readonly WorkspaceContextAction[],
): void {
  closeWorkspaceContextMenu();
  const menu = document.createElement('div');
  menu.className = 'workspace-context-menu';
  menu.setAttribute('role', 'menu');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = action.label;
    button.addEventListener('click', () => {
      closeWorkspaceContextMenu();
      action.run();
    });
    menu.append(button);
  }
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${String(Math.max(8, Math.min(clientX, window.innerWidth - bounds.width - 8)))}px`;
  menu.style.top = `${String(Math.max(8, Math.min(clientY, window.innerHeight - bounds.height - 8)))}px`;
  workspaceContextMenu = menu;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

function closeWorkspaceContextMenu(): void {
  workspaceContextMenu?.remove();
  workspaceContextMenu = undefined;
}

function copyPlainText(text: string, message: string): void {
  if (companionBridge?.writeClipboard(text) === true) showReferenceFeedback(message);
}

function showReferenceFeedback(message: string): void {
  let feedback = document.querySelector<HTMLElement>('[data-testid="reference-feedback"]');
  if (feedback === null) {
    feedback = document.createElement('div');
    feedback.className = 'reference-feedback';
    feedback.dataset.testid = 'reference-feedback';
    feedback.setAttribute('role', 'status');
    document.body.append(feedback);
  }
  feedback.textContent = message;
  feedback.dataset.visible = 'true';
  if (referenceFeedbackTimer !== undefined) window.clearTimeout(referenceFeedbackTimer);
  referenceFeedbackTimer = window.setTimeout(() => {
    referenceFeedbackTimer = undefined;
    feedback.dataset.visible = 'false';
  }, 1_500);
}

function syncPreviewFindControls(snapshot: WorkspaceReviewSnapshot): void {
  const find = snapshot.find;
  if (previewFindBar !== null) previewFindBar.hidden = !find.open || snapshot.preview === undefined;
  if (previewFindToggle !== null) previewFindToggle.setAttribute('aria-pressed', String(find.open));
  if (previewFindInput !== null && previewFindInput.value !== find.query) {
    previewFindInput.value = find.query;
  }
  if (previewFindProgress !== null) {
    previewFindProgress.textContent = find.query === ''
      ? '0 / 0'
      : `${String(find.position ?? 0)} / ${String(find.total)}`;
  }
  if (previewFindPrevious !== null) previewFindPrevious.disabled = !find.canPrevious;
  if (previewFindNext !== null) previewFindNext.disabled = !find.canNext;
}

function refreshPreviewFindMatches(scrollCurrent: boolean): WorkspaceReviewSnapshot {
  const state = reviewController.getSnapshot();
  if (previewContent === null || !state.find.open || state.find.query === '') {
    const snapshot = reviewController.execute({ kind: 'find.matches', total: 0 }).snapshot;
    syncPreviewFindControls(snapshot);
    return snapshot;
  }
  const query = state.find.query.toLocaleLowerCase();
  const walker = document.createTreeWalker(previewContent, NodeFilter.SHOW_TEXT);
  const matches: Array<{ node: Text; start: number; index: number }> = [];
  let node = walker.nextNode();
  while (node !== null) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest('.text-line-number, .diff-old-number, .diff-new-number') !== null) {
      node = walker.nextNode();
      continue;
    }
    const content = textNode.data.toLocaleLowerCase();
    let start = content.indexOf(query);
    while (start >= 0) {
      matches.push({ node: textNode, start, index: matches.length });
      start = content.indexOf(query, start + Math.max(1, query.length));
    }
    node = walker.nextNode();
  }
  for (const textNode of new Set(matches.map((match) => match.node))) {
    const nodeMatches = matches.filter((match) => match.node === textNode);
    for (const match of [...nodeMatches].reverse()) {
      const matched = textNode.splitText(match.start);
      matched.splitText(state.find.query.length);
      const mark = document.createElement('mark');
      mark.className = 'preview-find-match';
      mark.dataset.matchIndex = String(match.index);
      matched.replaceWith(mark);
      mark.append(matched);
    }
  }
  const snapshot = reviewController.execute({ kind: 'find.matches', total: matches.length }).snapshot;
  syncPreviewFindControls(snapshot);
  applyPreviewFindPosition(snapshot, scrollCurrent);
  return snapshot;
}

function applyPreviewFindPosition(snapshot: WorkspaceReviewSnapshot, scrollCurrent: boolean): void {
  for (const mark of previewContent?.querySelectorAll<HTMLElement>('.preview-find-match') ?? []) {
    mark.removeAttribute('data-current');
  }
  if (snapshot.find.position === undefined) return;
  const current = previewContent?.querySelector<HTMLElement>(
    `.preview-find-match[data-match-index="${String(snapshot.find.position - 1)}"]`,
  );
  if (current === null || current === undefined) return;
  current.dataset.current = 'true';
  if (scrollCurrent) current.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function openPreviewFind(): void {
  const snapshot = reviewController.execute({ kind: 'find.open' }).snapshot;
  if (!snapshot.find.open) return;
  syncPreviewFindControls(snapshot);
  previewFindInput?.focus();
  previewFindInput?.select();
}

function closePreviewFind(): void {
  const snapshot = reviewController.execute({ kind: 'find.close' }).snapshot;
  syncPreviewFindControls(snapshot);
  renderPreview();
}

function movePreviewFind(direction: 'previous' | 'next'): void {
  const snapshot = reviewController.execute({ kind: 'find.move', direction }).snapshot;
  syncPreviewFindControls(snapshot);
  applyPreviewFindPosition(snapshot, true);
}

function syncReviewProgress(snapshot: WorkspaceReviewSnapshot): void {
  const showingReview = snapshot.preview?.content.kind === 'diff' && snapshot.review.position !== undefined;
  if (reviewBar !== null) reviewBar.hidden = !showingReview;
  if (reviewProgress !== null) {
    reviewProgress.textContent = `${String(snapshot.review.position ?? 0)} / ${String(snapshot.review.total)} · 已查看 ${String(snapshot.review.viewed)}`;
  }
  if (reviewPrevious !== null) reviewPrevious.disabled = !snapshot.review.canPrevious;
  if (reviewNext !== null) reviewNext.disabled = !snapshot.review.canNext;
  if (reviewToggleViewed !== null) {
    reviewToggleViewed.dataset.viewed = String(snapshot.review.currentViewed);
    reviewToggleViewed.textContent = snapshot.review.currentViewed ? '已查看' : '标为已查看';
  }
}

function closePreview(): void {
  if (currentPreview === undefined && previewPanel?.hidden !== false) return;
  applyReviewSnapshot(reviewController.execute({ kind: 'preview.close' }).snapshot);
  companionBridge?.setPreviewOpen(false);
  if (previewPanel !== null) previewPanel.hidden = true;
}

function renderPreview(scrollFind = false): void {
  const preview = currentPreview;
  if (preview === undefined || previewContent === null) return;
  if (previewName !== null) previewName.textContent = preview.name;
  if (previewPath !== null) previewPath.textContent = preview.content.kind === 'diff'
    ? `${preview.path} · +${String(preview.content.additions)} −${String(preview.content.deletions)}`
    : preview.path;
  previewContent.replaceChildren();
  const content = preview.content;
  if (previewMode !== null) {
    previewMode.hidden = content.kind !== 'markdown';
    previewMode.textContent = showingMarkdownSource ? '预览' : '源码';
  }
  if (content.kind === 'image') {
    const image = document.createElement('img');
    image.src = content.dataUrl;
    image.alt = preview.name;
    previewContent.append(image);
  } else if (content.kind === 'markdown' && !showingMarkdownSource) {
    previewContent.append(renderMarkdown(content.text));
  } else if (content.kind === 'diff') {
    previewContent.append(renderDiff(content.text));
  } else if ('text' in content) {
    previewContent.append(renderText(content.text));
  } else {
    previewContent.append(createEmptyRow(
      content.reason === 'too-large' ? '文件过大，无法在应用内预览' : content.reason === 'binary' ? '二进制文件不支持预览' : '此文件类型暂不支持预览',
    ));
  }
  refreshPreviewFindMatches(scrollFind);
}

function renderText(source: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'text-view';
  const selectedKey = reviewController.getSnapshot().selectedLineKey;
  for (const [index, text] of source.replaceAll('\r\n', '\n').split('\n').entries()) {
    const line = index + 1;
    const key = `text-${String(line)}`;
    const row = document.createElement('div');
    row.className = 'text-row';
    row.dataset.referenceLine = String(line);
    if (key === selectedKey) row.dataset.selected = 'true';
    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'text-line-number';
    number.dataset.lineKey = key;
    number.textContent = String(line);
    number.setAttribute('aria-label', `选择第 ${String(line)} 行`);
    number.addEventListener('click', () => selectPreviewLine(line, key));
    const code = document.createElement('span');
    code.className = 'text-line-code';
    code.textContent = text === '' ? ' ' : text;
    row.append(number, code);
    container.append(row);
  }
  return container;
}

function renderDiff(source: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'diff-view';
  const selectedKey = reviewController.getSnapshot().selectedLineKey;
  for (const [index, row] of structuredDiffRows(source).entries()) {
    const element = document.createElement('div');
    element.className = `diff-row diff-${row.kind}`;
    if (row.kind === 'fold' || row.kind === 'hunk') {
      const label = document.createElement('span');
      label.className = 'diff-wide-label';
      label.textContent = row.label;
      element.append(label);
    } else {
      const oldNumber = document.createElement('button');
      oldNumber.type = 'button';
      oldNumber.className = 'diff-old-number';
      oldNumber.textContent = row.oldLine === undefined ? '' : String(row.oldLine);
      oldNumber.disabled = row.oldLine === undefined;
      const oldKey = `diff-${String(index)}-old-${String(row.oldLine ?? 0)}`;
      oldNumber.dataset.lineKey = oldKey;
      if (row.oldLine !== undefined) {
        oldNumber.setAttribute('aria-label', `选择旧文件第 ${String(row.oldLine)} 行`);
        oldNumber.addEventListener('click', () => selectPreviewLine(row.oldLine!, oldKey));
      }
      const newNumber = document.createElement('button');
      newNumber.type = 'button';
      newNumber.className = 'diff-new-number';
      newNumber.textContent = row.newLine === undefined ? '' : String(row.newLine);
      newNumber.disabled = row.newLine === undefined;
      const newKey = `diff-${String(index)}-new-${String(row.newLine ?? 0)}`;
      newNumber.dataset.lineKey = newKey;
      if (row.newLine !== undefined) {
        newNumber.setAttribute('aria-label', `选择新文件第 ${String(row.newLine)} 行`);
        newNumber.addEventListener('click', () => selectPreviewLine(row.newLine!, newKey));
      }
      if (oldKey === selectedKey || newKey === selectedKey) element.dataset.selected = 'true';
      const referenceLine = row.newLine ?? row.oldLine;
      if (referenceLine !== undefined) element.dataset.referenceLine = String(referenceLine);
      const marker = document.createElement('span');
      marker.className = 'diff-marker';
      marker.textContent = row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : ' ';
      const code = document.createElement('span');
      code.className = 'diff-code';
      code.textContent = row.text === '' ? ' ' : row.text;
      element.append(oldNumber, newNumber, marker, code);
    }
    container.append(element);
  }
  return container;
}

function renderMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseSafeMarkdown(source)) {
    if (block.kind === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'markdown-code';
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.append(code);
      fragment.append(pre);
    } else if (block.kind === 'list') {
      const list = document.createElement('ul');
      for (const item of block.items) {
        const element = document.createElement('li');
        appendSafeInline(element, item);
        list.append(element);
      }
      fragment.append(list);
    } else {
      const tag = block.kind === 'heading' ? `h${String(block.level)}` : block.kind === 'blockquote' ? 'blockquote' : 'p';
      const element = document.createElement(tag);
      appendSafeInline(element, block.content);
      fragment.append(element);
    }
  }
  return fragment;
}

function appendSafeInline(parent: HTMLElement, content: readonly SafeMarkdownInline[]): void {
  for (const part of content) {
    if (part.kind === 'code') {
      const code = document.createElement('code');
      code.textContent = part.text;
      parent.append(code);
    } else if (part.kind === 'workspace-link') {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'markdown-workspace-link';
      link.textContent = part.text;
      link.title = part.target;
      link.addEventListener('click', () => {
        const preview = currentPreview;
        if (preview !== undefined) void openRelativePreview(preview.nodeId, part.target);
      });
      parent.append(link);
    } else parent.append(document.createTextNode(part.text));
  }
}

function createEmptyRow(message: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'review-empty-row';
  element.textContent = message;
  return element;
}

function setReviewSelection(nodeId?: string): void {
  for (const row of document.querySelectorAll<HTMLElement>('.change-row[data-node-id], .file-row[data-node-id]')) {
    if (nodeId !== undefined && row.dataset.nodeId === nodeId) {
      row.setAttribute('aria-current', 'true');
    } else {
      row.removeAttribute('aria-current');
    }
  }
}

function statusLabel(status: string): string {
  return ({ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!' } as Record<string, string>)[status] ?? 'M';
}

function fileIcon(extension?: string): string {
  if (extension === 'md' || extension === 'markdown') return 'MD';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension ?? '')) return 'IMG';
  return '·';
}

function activateReviewTab(target: 'changes' | 'files'): void {
  const snapshot = reviewController.execute({ kind: 'tab.select', tab: target }).snapshot;
  syncReviewControls(snapshot);
  renderReviewSnapshot(snapshot);
}

function syncReviewControls(snapshot: WorkspaceReviewSnapshot): void {
  for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')) {
    candidate.setAttribute('aria-selected', String(candidate.dataset.reviewTab === snapshot.tab));
  }
  if (changesView !== null) changesView.hidden = snapshot.tab !== 'changes';
  if (filesView !== null) filesView.hidden = snapshot.tab !== 'files';
  if (reviewSearch !== null) {
    if (reviewSearch.value !== snapshot.query) reviewSearch.value = snapshot.query;
    reviewSearch.placeholder = snapshot.tab === 'files' ? '搜索文件…' : '筛选变更…';
    reviewSearch.setAttribute('aria-label', snapshot.tab === 'files' ? '搜索工作区文件' : '筛选工作区变更');
  }
  if (changeFilter !== null) {
    changeFilter.hidden = snapshot.tab !== 'changes';
    changeFilter.value = snapshot.scope;
  }
}

function renderReviewSnapshot(snapshot: WorkspaceReviewSnapshot): void {
  syncReviewControls(snapshot);
  syncReviewProgress(snapshot);
  if (snapshot.tab === 'changes') {
    if (reviewNote !== null) reviewNote.textContent = overviewNote;
    renderChanges(snapshot);
  } else {
    applyReviewQuery();
  }
}

function moveReview(direction: 'previous' | 'next'): void {
  const transition = reviewController.execute({ kind: 'review.move', direction });
  if (transition.effect?.kind === 'open-diff') void openDiff(transition.effect.nodeId);
}

function handleWorkspaceReviewShortcut(shortcut: WorkspaceReviewShortcut): boolean {
  if (shortcut === 'file-search') {
    const snapshot = latestCompanionSnapshot;
    if (companionBridge === undefined || snapshot?.active !== true || snapshot.workspace.status !== 'ready') return false;
    if (!snapshot.open) companionBridge.toggle();
    activateReviewTab('files');
    reviewSearch?.focus();
    reviewSearch?.select();
    return true;
  }
  if (shortcut === 'preview-find' && currentPreview !== undefined) {
    openPreviewFind();
    return true;
  }
  if (shortcut === 'preview-back' && previewBack?.disabled === false) {
    applyReviewSnapshot(reviewController.execute({ kind: 'preview.back' }).snapshot);
    return true;
  }
  if (shortcut === 'preview-forward' && previewForward?.disabled === false) {
    applyReviewSnapshot(reviewController.execute({ kind: 'preview.forward' }).snapshot);
    return true;
  }
  if (shortcut === 'close-preview' && currentPreview !== undefined) {
    if (reviewController.getSnapshot().find.open) {
      closePreviewFind();
      return true;
    }
    closePreview();
    return true;
  }
  return false;
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.reviewTab === 'files' ? 'files' : 'changes';
    activateReviewTab(target);
  });
}
reviewSearch?.addEventListener('input', scheduleReviewQuery);
reviewSearch?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || reviewSearch.value === '') return;
  event.preventDefault();
  reviewSearch.value = '';
  scheduleReviewQuery();
});
changeFilter?.addEventListener('change', () => {
  reviewController.execute({ kind: 'scope.change', scope: validatedChangeScope(changeFilter.value) });
  applyReviewQuery();
});
document.querySelector('[data-testid="review-refresh"]')?.addEventListener('click', () => {
  if (loadedWorkspaceId !== undefined) void loadOverview(loadedWorkspaceId);
});
document.querySelector('[data-testid="preview-close"]')?.addEventListener('click', closePreview);
previewBack?.addEventListener('click', () => applyReviewSnapshot(reviewController.execute({ kind: 'preview.back' }).snapshot));
previewForward?.addEventListener('click', () => applyReviewSnapshot(reviewController.execute({ kind: 'preview.forward' }).snapshot));
previewFindToggle?.addEventListener('click', () => {
  if (reviewController.getSnapshot().find.open) closePreviewFind();
  else openPreviewFind();
});
previewFindInput?.addEventListener('input', () => {
  reviewController.execute({ kind: 'find.change', query: previewFindInput.value });
  renderPreview(true);
});
previewFindInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closePreviewFind();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    movePreviewFind(event.shiftKey ? 'previous' : 'next');
  }
});
document.querySelector('[data-testid="preview-find-close"]')?.addEventListener('click', closePreviewFind);
previewFindPrevious?.addEventListener('click', () => movePreviewFind('previous'));
previewFindNext?.addEventListener('click', () => movePreviewFind('next'));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-target]')) {
  button.addEventListener('click', () => {
    const target = button.dataset.copyTarget;
    if (target === 'path' || target === 'line' || target === 'path-line') copyPreviewTarget(target);
  });
}
document.addEventListener('pointerdown', (event) => {
  if (previewCopyMenu?.open === true && !previewCopyMenu.contains(event.target as Node)) {
    previewCopyMenu.open = false;
  }
  if (workspaceContextMenu !== undefined && !workspaceContextMenu.contains(event.target as Node)) {
    closeWorkspaceContextMenu();
  }
});
previewContent?.addEventListener('contextmenu', (event) => {
  const selectionReference = previewSelectionReference();
  if (selectionReference !== undefined) {
    event.preventDefault();
    showWorkspaceContextMenu(event.clientX, event.clientY, [
      {
        label: '添加选中内容到对话',
        run: () => addReferenceToConversation(selectionReference),
      },
      {
        label: '复制选中文本',
        run: () => copyPlainText(selectionReference.text, '已复制选中文本'),
      },
    ]);
    return;
  }
  const row = (event.target as Element | null)?.closest<HTMLElement>('[data-reference-line]');
  if (row === null || row === undefined) return;
  const lineReference = selectedLineReference(row);
  if (lineReference === undefined) return;
  event.preventDefault();
  showWorkspaceContextMenu(event.clientX, event.clientY, [
    { label: '添加此行到对话', run: () => addReferenceToConversation(lineReference) },
    { label: '复制此行文本', run: () => copyPlainText(lineReference.text, '已复制此行文本') },
    {
      label: '复制 路径:行号',
      run: () => copyPlainText(
        `${lineReference.path}:${String(lineReference.startLine)}`,
        '已复制位置',
      ),
    },
  ]);
});
window.addEventListener('blur', closeWorkspaceContextMenu);
window.addEventListener('scroll', closeWorkspaceContextMenu, true);
previewMode?.addEventListener('click', () => {
  showingMarkdownSource = !showingMarkdownSource;
  const snapshot = reviewController.execute({ kind: 'line.select', line: undefined }).snapshot;
  syncPreviewCopyControls(snapshot);
  renderPreview(true);
});
reviewPrevious?.addEventListener('click', () => moveReview('previous'));
reviewNext?.addEventListener('click', () => moveReview('next'));
reviewToggleViewed?.addEventListener('click', () => {
  const snapshot = reviewController.execute({ kind: 'review.toggle' }).snapshot;
  applyReviewSnapshot(snapshot);
  renderChanges(snapshot);
});
document.addEventListener('keydown', (event) => {
  const shortcut = workspaceReviewShortcut(event);
  if (shortcut !== undefined && handleWorkspaceReviewShortcut(shortcut)) event.preventDefault();
});

if (failed) {
  document.body.dataset.state = 'failure';
  const heading = document.querySelector('h1');
  if (heading !== null) {
    heading.textContent = 'DeepSeek Harness 启动失败';
  }
  if (status !== null) {
    const code = parameters.get('code') ?? 'unknown';
    status.textContent = startupFailureCopy(code);
  }
  document.querySelector('.progress-track')?.remove();
  const actions = document.querySelector<HTMLElement>('.failure-actions');
  if (actions !== null) {
    actions.hidden = false;
  }
} else if (
  status !== null &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  const messages = [
    '正在准备本地开发环境',
    '正在连接 DeepSeek Harness',
    '即将进入你的工作空间',
  ];
  let messageIndex = 0;
  window.setInterval(() => {
    messageIndex = (messageIndex + 1) % messages.length;
    status.classList.add('is-changing');
    window.setTimeout(() => {
      status.textContent =
        messages[messageIndex] ?? '正在准备本地开发环境';
      status.classList.remove('is-changing');
    }, 180);
  }, 1_200);
}
