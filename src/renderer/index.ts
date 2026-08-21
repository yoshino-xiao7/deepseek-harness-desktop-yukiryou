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
  filterWorkspaceChanges,
  type WorkspaceChangeScope,
} from './workspace-review-query.js';
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
let loadedWorkspaceId: string | undefined;
let reviewLoadRevision = 0;
let currentPreview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined;
let showingMarkdownSource = false;
let currentOverview: Extract<WorkspaceReviewResponse, { kind: 'overview' }> | undefined;
let activeReviewTab: 'changes' | 'files' = 'changes';
let searchRevision = 0;
let searchTimer: number | undefined;
let overviewNote = '';
const companionPanelWidthStorageKey = 'dsh.desktop.companion.panel-width';
const companionBridge = (
  window as unknown as {
    deepSeekYukiRyouCompanion?: {
      getSnapshot(): DesktopCompanionSnapshot;
      subscribe(listener: (snapshot: DesktopCompanionSnapshot) => void): () => void;
      toggle(): void;
      setPreviewOpen(open: boolean): void;
      resize(width: number): void;
      request(request: WorkspaceReviewRequest): Promise<WorkspaceReviewResponse>;
      subscribeReviewTarget(listener: (preview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined) => void): () => void;
    };
  }
).deepSeekYukiRyouCompanion;

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
    if (workspace.workspaceId !== loadedWorkspaceId) {
      loadedWorkspaceId = workspace.workspaceId;
      void loadOverview(workspace.workspaceId);
    }
  } else {
    loadedWorkspaceId = undefined;
    if (reviewBrowser !== null) reviewBrowser.hidden = true;
    if (companionEmpty !== null) companionEmpty.hidden = false;
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
  companionBridge.subscribeReviewTarget((preview) => {
    if (preview === undefined) {
      currentPreview = undefined;
      showingMarkdownSource = false;
      previewContent?.replaceChildren();
      setReviewSelection();
      return;
    }
    currentPreview = preview;
    showingMarkdownSource = false;
    setReviewSelection(preview.nodeId);
    renderPreview();
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
  currentOverview = response;
  overviewNote = response.truncated
    ? '内容较多，仅显示前一部分。'
    : response.gitAvailable
      ? '只读视图 · 相对 HEAD 的当前工作区变更'
      : '此目录不是 Git 工作区，仍可浏览文件。';
  if (companionEmpty !== null) companionEmpty.hidden = true;
  if (reviewBrowser !== null) reviewBrowser.hidden = false;
  applyReviewQuery();
  setReviewSelection(currentPreview?.nodeId);
  if (reviewNote !== null) reviewNote.textContent = overviewNote;
}

function setReviewLoading(loading: boolean): void {
  const refresh = document.querySelector<HTMLButtonElement>('[data-testid="review-refresh"]');
  if (refresh !== null) refresh.disabled = loading;
}

function renderChanges(response: Extract<WorkspaceReviewResponse, {kind:'overview'}>): void {
  if (changesView === null) return;
  changesView.replaceChildren();
  const scope = validatedChangeScope(changeFilter?.value);
  const changes = filterWorkspaceChanges(response.changes, {
    query: reviewSearch?.value ?? '',
    scope,
  });
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
  appendChangeTree(changesView, tree, 0);
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

function appendChangeTree(parent: HTMLElement, tree: ChangeTree, depth: number): void {
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
    appendChangeTree(children, child, depth + 1);
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
    button.append(badge, path, stats);
    if (change.nodeId !== undefined) button.addEventListener('click', () => void openDiff(change.nodeId!));
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
  for (const node of nodes) filesView.append(createNodeRow(node, 0));
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
  const overview = currentOverview;
  if (overview === undefined) return;
  if (activeReviewTab === 'changes') {
    if (reviewNote !== null) reviewNote.textContent = overviewNote;
    renderChanges(overview);
    return;
  }
  const query = reviewSearch?.value.trim() ?? '';
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
    revision !== searchRevision || activeReviewTab !== 'files'
    || query !== (reviewSearch?.value.trim() ?? '')
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
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  if (activeReviewTab === 'changes') {
    applyReviewQuery();
    return;
  }
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    applyReviewQuery();
  }, 180);
}

function createNodeRow(node: WorkspaceNode, depth: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-row';
  button.style.setProperty('--tree-depth', String(depth));
  button.dataset.nodeId = node.id;
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
  } else {
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => void toggleDirectory(wrapper, button, node, depth));
  }
  return wrapper;
}

async function toggleDirectory(wrapper: HTMLElement, button: HTMLButtonElement, node: WorkspaceNode, depth: number): Promise<void> {
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
  for (const child of response.nodes) children.append(createNodeRow(child, depth + 1));
  wrapper.append(children);
  button.setAttribute('aria-expanded', 'true');
}

async function openPreview(nodeId: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'file.preview', nodeId });
  if (response.kind !== 'preview') return;
  currentPreview = response;
  showingMarkdownSource = false;
  setReviewSelection(response.nodeId);
  companionBridge.setPreviewOpen(true);
  renderPreview();
}

async function openRelativePreview(nodeId: string, target: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'file.preview-relative', nodeId, target });
  if (response.kind !== 'preview') return;
  currentPreview = response;
  showingMarkdownSource = false;
  setReviewSelection(response.nodeId);
  companionBridge.setPreviewOpen(true);
  renderPreview();
}

async function openDiff(nodeId: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'change.diff', nodeId });
  if (response.kind !== 'preview') return;
  currentPreview = response;
  showingMarkdownSource = false;
  setReviewSelection(response.nodeId);
  companionBridge.setPreviewOpen(true);
  renderPreview();
}

function closePreview(): void {
  if (currentPreview === undefined && previewPanel?.hidden !== false) return;
  currentPreview = undefined;
  setReviewSelection();
  companionBridge?.setPreviewOpen(false);
  if (previewPanel !== null) previewPanel.hidden = true;
}

function renderPreview(): void {
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
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = content.text;
    pre.append(code);
    previewContent.append(pre);
  } else {
    previewContent.append(createEmptyRow(
      content.reason === 'too-large' ? '文件过大，无法在应用内预览' : content.reason === 'binary' ? '二进制文件不支持预览' : '此文件类型暂不支持预览',
    ));
  }
}

function renderDiff(source: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'diff-view';
  for (const row of structuredDiffRows(source)) {
    const element = document.createElement('div');
    element.className = `diff-row diff-${row.kind}`;
    if (row.kind === 'fold' || row.kind === 'hunk') {
      const label = document.createElement('span');
      label.className = 'diff-wide-label';
      label.textContent = row.label;
      element.append(label);
    } else {
      const oldNumber = document.createElement('span');
      oldNumber.className = 'diff-old-number';
      oldNumber.textContent = row.oldLine === undefined ? '' : String(row.oldLine);
      const newNumber = document.createElement('span');
      newNumber.className = 'diff-new-number';
      newNumber.textContent = row.newLine === undefined ? '' : String(row.newLine);
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

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.reviewTab;
    activeReviewTab = target === 'files' ? 'files' : 'changes';
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')) candidate.setAttribute('aria-selected', String(candidate === tab));
    if (changesView !== null) changesView.hidden = target !== 'changes';
    if (filesView !== null) filesView.hidden = target !== 'files';
    if (reviewSearch !== null) {
      reviewSearch.placeholder = activeReviewTab === 'files' ? '搜索文件…' : '筛选变更…';
      reviewSearch.setAttribute('aria-label', activeReviewTab === 'files' ? '搜索工作区文件' : '筛选工作区变更');
    }
    if (changeFilter !== null) changeFilter.hidden = activeReviewTab !== 'changes';
    applyReviewQuery();
  });
}
reviewSearch?.addEventListener('input', scheduleReviewQuery);
reviewSearch?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || reviewSearch.value === '') return;
  event.preventDefault();
  reviewSearch.value = '';
  scheduleReviewQuery();
});
changeFilter?.addEventListener('change', applyReviewQuery);
document.querySelector('[data-testid="review-refresh"]')?.addEventListener('click', () => {
  if (loadedWorkspaceId !== undefined) void loadOverview(loadedWorkspaceId);
});
document.querySelector('[data-testid="preview-close"]')?.addEventListener('click', closePreview);
previewMode?.addEventListener('click', () => { showingMarkdownSource = !showingMarkdownSource; renderPreview(); });

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
