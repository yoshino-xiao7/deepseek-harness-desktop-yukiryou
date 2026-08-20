import {
  COMPANION_PANEL_DEFAULT_WIDTH,
  COMPANION_PANEL_MAX_WIDTH,
  COMPANION_PANEL_MIN_WIDTH,
  clampCompanionPreferredWidth,
  resolvedCompanionPanelWidth,
  type DesktopCompanionSnapshot,
} from '../shared/desktop-companion.js';
import type { PetAssetSummary } from '../shared/pet-library.js';
import type { PetStageSurfaceSnapshot } from '../shared/pet-stage-surface.js';
import type {
  WorkspaceNode,
  WorkspaceReviewRequest,
  WorkspaceReviewResponse,
} from '../shared/workspace-review.js';
import { structuredDiffRows } from './diff-model.js';
import {
  parseSafeMarkdown,
  type SafeMarkdownInline,
} from './safe-markdown.js';

const parameters = new URLSearchParams(window.location.search);
const failed = parameters.get('state') === 'failure';
const status = document.querySelector<HTMLElement>('[data-testid="startup-status"]');
const companionToggle = document.querySelector<HTMLButtonElement>('[data-testid="companion-toggle"]');
const companionPanel = document.querySelector<HTMLElement>('[data-testid="companion-panel"]');
const companionResize = document.querySelector<HTMLElement>('[data-testid="companion-resize"]');
const petStage = document.querySelector<HTMLElement>('[data-testid="pet-stage"]');
const petPlayerSurface = document.querySelector<HTMLElement>('[data-testid="pet-player-surface"]');
const petStageThumbnail = document.querySelector<HTMLImageElement>('[data-testid="pet-stage-thumbnail"]');
const petStageName = document.querySelector<HTMLElement>('[data-testid="pet-stage-name"]');
const petBubble = document.querySelector<HTMLElement>('[data-testid="pet-bubble"]');
const companionTitle = document.querySelector<HTMLElement>('[data-testid="companion-workspace-title"]');
const companionRunning = document.querySelector<HTMLElement>('[data-testid="companion-running"]');
const companionEmpty = document.querySelector<HTMLElement>('[data-testid="companion-empty"]');
const reviewBrowser = document.querySelector<HTMLElement>('[data-testid="review-browser"]');
const changesView = document.querySelector<HTMLElement>('[data-review-view="changes"]');
const filesView = document.querySelector<HTMLElement>('[data-review-view="files"]');
const changeCount = document.querySelector<HTMLElement>('[data-testid="change-count"]');
const reviewNote = document.querySelector<HTMLElement>('[data-testid="review-note"]');
const previewPanel = document.querySelector<HTMLElement>('[data-testid="preview-panel"]');
const previewName = document.querySelector<HTMLElement>('[data-testid="preview-name"]');
const previewPath = document.querySelector<HTMLElement>('[data-testid="preview-path"]');
const previewContent = document.querySelector<HTMLElement>('[data-testid="preview-content"]');
const previewMode = document.querySelector<HTMLButtonElement>('[data-testid="preview-mode"]');
let loadedWorkspaceId: string | undefined;
let reviewLoadRevision = 0;
let currentPreview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined;
let showingMarkdownSource = false;
let currentCompanionSnapshot: DesktopCompanionSnapshot | undefined;
let wakeGeneration = 0;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const companionBridge = (
  window as unknown as {
    deepSeekYukiRyouCompanion?: {
      getSnapshot(): DesktopCompanionSnapshot;
      subscribe(listener: (snapshot: DesktopCompanionSnapshot) => void): () => void;
      toggle(): void;
      setPreviewOpen(open: boolean): void;
      resize(preferredWidth: number, commit?: boolean): void;
      request(request: WorkspaceReviewRequest): Promise<WorkspaceReviewResponse>;
      subscribeReviewTarget(listener: (preview: Extract<WorkspaceReviewResponse, { kind: 'preview' }> | undefined) => void): () => void;
    };
  }
).deepSeekYukiRyouCompanion;
const petStageBridge = (
  window as unknown as {
    deepSeekYukiRyouPetStage?: {
      getSnapshot(): { readonly enabled: boolean; readonly asset?: PetAssetSummary };
      subscribe(listener: (snapshot: { readonly enabled: boolean; readonly asset?: PetAssetSummary }) => void): () => void;
      presentSurface(snapshot: PetStageSurfaceSnapshot): void;
      wake(): void;
    };
  }
).deepSeekYukiRyouPetStage;

function renderCompanion(snapshot: DesktopCompanionSnapshot): void {
  currentCompanionSnapshot = snapshot;
  applyCompanionWidth(snapshot);
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
  if (petBubble !== null) petBubble.hidden = !running;
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
  window.requestAnimationFrame(reportPetPlayerSurface);
  window.setTimeout(reportPetPlayerSurface, 240);
}

function applyCompanionWidth(snapshot: DesktopCompanionSnapshot): void {
  const preferredWidth = snapshot.preferredWidth ?? COMPANION_PANEL_DEFAULT_WIDTH;
  const panelWidth = resolvedCompanionPanelWidth(
    window.innerWidth,
    preferredWidth,
    snapshot.previewOpen && window.innerWidth >= 1_320,
  );
  const maximumWidth = resolvedCompanionPanelWidth(
    window.innerWidth,
    COMPANION_PANEL_MAX_WIDTH,
    snapshot.previewOpen && window.innerWidth >= 1_320,
  );
  document.documentElement.style.setProperty('--companion-panel-width', `${String(panelWidth)}px`);
  if (companionResize !== null) {
    companionResize.setAttribute('aria-valuemin', String(COMPANION_PANEL_MIN_WIDTH));
    companionResize.setAttribute('aria-valuemax', String(maximumWidth));
    companionResize.setAttribute('aria-valuenow', String(panelWidth));
  }
}

function renderPetStage(snapshot: { readonly enabled: boolean; readonly asset?: PetAssetSummary }): void {
  const visible = snapshot.enabled && snapshot.asset !== undefined;
  if (petStage === null) return;
  petStage.hidden = !visible;
  reportPetPlayerSurface();
  if (!visible || snapshot.asset === undefined) return;
  if (petStageThumbnail !== null) petStageThumbnail.src = snapshot.asset.thumbnailUrl;
  if (petStageName !== null) petStageName.textContent = snapshot.asset.name;
}

if (companionBridge !== undefined) {
  renderCompanion(companionBridge.getSnapshot());
  companionBridge.subscribe(renderCompanion);
  companionBridge.subscribeReviewTarget((preview) => {
    if (preview === undefined) {
      currentPreview = undefined;
      showingMarkdownSource = false;
      previewContent?.replaceChildren();
      return;
    }
    currentPreview = preview;
    showingMarkdownSource = false;
    renderPreview();
  });
  companionToggle?.addEventListener('click', () => companionBridge.toggle());
  companionResize?.addEventListener('pointerdown', beginCompanionResize);
  companionResize?.addEventListener('keydown', resizeCompanionWithKeyboard);
  companionResize?.addEventListener('dblclick', () => companionBridge.resize(COMPANION_PANEL_DEFAULT_WIDTH, true));
}

if (petStageBridge !== undefined) {
  renderPetStage(petStageBridge.getSnapshot());
  petStageBridge.subscribe(renderPetStage);
}

const petSurfaceObserver = typeof ResizeObserver === 'undefined' || petPlayerSurface === null
  ? undefined
  : new ResizeObserver(() => reportPetPlayerSurface());
if (petSurfaceObserver !== undefined && petPlayerSurface !== null) {
  petSurfaceObserver.observe(petPlayerSurface);
}
reducedMotionQuery.addEventListener('change', reportPetPlayerSurface);

window.addEventListener('resize', () => {
  if (currentCompanionSnapshot !== undefined) applyCompanionWidth(currentCompanionSnapshot);
  reportPetPlayerSurface();
});

function reportPetPlayerSurface(): void {
  if (petStageBridge === undefined || petStage === null || petPlayerSurface === null || petStage.hidden) {
    petStageBridge?.presentSurface({ visible: false });
    return;
  }
  const bounds = petPlayerSurface.getBoundingClientRect();
  petStageBridge.presentSurface({
    visible: true,
    bounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    },
    devicePixelRatio: window.devicePixelRatio,
    reducedMotion: reducedMotionQuery.matches,
  });
}

function beginCompanionResize(event: PointerEvent): void {
  if (companionBridge === undefined || companionResize === null || currentCompanionSnapshot === undefined) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = currentCompanionSnapshot.preferredWidth ?? COMPANION_PANEL_DEFAULT_WIDTH;
  companionResize.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent): void => {
    companionBridge.resize(clampCompanionPreferredWidth(startWidth + startX - next.clientX));
  };
  const finish = (next: PointerEvent): void => {
    companionResize.releasePointerCapture(next.pointerId);
    companionResize.removeEventListener('pointermove', move);
    companionResize.removeEventListener('pointerup', finish);
    companionResize.removeEventListener('pointercancel', finish);
    companionBridge.resize(clampCompanionPreferredWidth(startWidth + startX - next.clientX), true);
  };
  companionResize.addEventListener('pointermove', move);
  companionResize.addEventListener('pointerup', finish);
  companionResize.addEventListener('pointercancel', finish);
}

function resizeCompanionWithKeyboard(event: KeyboardEvent): void {
  if (companionBridge === undefined || currentCompanionSnapshot === undefined) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const step = event.shiftKey ? 48 : 16;
  const current = currentCompanionSnapshot.preferredWidth ?? COMPANION_PANEL_DEFAULT_WIDTH;
  companionBridge.resize(current + (event.key === 'ArrowLeft' ? step : -step), true);
}

petStage?.addEventListener('click', wakePetStage);
petStage?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    wakePetStage();
  }
});

function wakePetStage(): void {
  wakeGeneration += 1;
  if (petStage !== null) petStage.dataset.wakeGeneration = String(wakeGeneration);
  petStageBridge?.wake();
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
  if (companionEmpty !== null) companionEmpty.hidden = true;
  if (reviewBrowser !== null) reviewBrowser.hidden = false;
  renderChanges(response);
  renderFileTree(response.nodes);
  if (reviewNote !== null) {
    reviewNote.textContent = response.truncated
      ? '内容较多，仅显示前一部分。'
      : response.gitAvailable
        ? '只读视图 · 相对 HEAD 的当前工作区变更'
        : '此目录不是 Git 工作区，仍可浏览文件。';
  }
}

function setReviewLoading(loading: boolean): void {
  const refresh = document.querySelector<HTMLButtonElement>('[data-testid="review-refresh"]');
  if (refresh !== null) refresh.disabled = loading;
}

function renderChanges(response: Extract<WorkspaceReviewResponse, {kind:'overview'}>): void {
  if (changesView === null) return;
  changesView.replaceChildren();
  if (changeCount !== null) changeCount.textContent = String(response.changes.length);
  if (response.changes.length === 0) {
    changesView.append(createEmptyRow(response.gitAvailable ? '当前没有未提交变更' : 'Git 变更不可用'));
    return;
  }
  const tree = createChangeTree(response.changes);
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
    chevron.textContent = '⌄';
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
  icon.textContent = node.kind === 'directory' ? '⌄' : fileIcon(node.extension);
  const name = document.createElement('span');
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
  companionBridge.setPreviewOpen(true);
  renderPreview();
}

async function openRelativePreview(nodeId: string, target: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'file.preview-relative', nodeId, target });
  if (response.kind !== 'preview') return;
  currentPreview = response;
  showingMarkdownSource = false;
  companionBridge.setPreviewOpen(true);
  renderPreview();
}

async function openDiff(nodeId: string): Promise<void> {
  if (companionBridge === undefined) return;
  const response = await companionBridge.request({ kind: 'change.diff', nodeId });
  if (response.kind !== 'preview') return;
  currentPreview = response;
  showingMarkdownSource = false;
  companionBridge.setPreviewOpen(true);
  renderPreview();
}

function closePreview(): void {
  if (currentPreview === undefined && previewPanel?.hidden !== false) return;
  currentPreview = undefined;
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

function statusLabel(status: string): string {
  return ({ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!' } as Record<string, string>)[status] ?? 'M';
}

function fileIcon(extension?: string): string {
  if (extension === 'md' || extension === 'markdown') return 'M↓';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension ?? '')) return '▧';
  return '·';
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.reviewTab;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-review-tab]')) candidate.setAttribute('aria-selected', String(candidate === tab));
    if (changesView !== null) changesView.hidden = target !== 'changes';
    if (filesView !== null) filesView.hidden = target !== 'files';
  });
}
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
    status.textContent = `错误类型：${code}。你可以重试，或导出诊断信息。`;
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
