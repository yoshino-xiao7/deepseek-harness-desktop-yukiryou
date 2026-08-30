/* global document, window */

window.__ModuleLoader__.load({
  id: '@dsh-desktop/companion',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const { isAppendSurfaceEvent } = require('@deepseek-ai/dsh-client-runtime/client');
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives');

    function lineCount(value) {
      if (typeof value !== 'string' || value === '') return 0;
      const lines = value.replaceAll('\r\n', '\n').split('\n');
      if (lines.at(-1) === '') lines.pop();
      return lines.length;
    }

    function replacementCounts(oldText, newText) {
      if (oldText === null) return { additions: lineCount(newText), deletions: 0 };
      const before = oldText.replaceAll('\r\n', '\n').split('\n');
      const after = newText.replaceAll('\r\n', '\n').split('\n');
      if (before.at(-1) === '') before.pop();
      if (after.at(-1) === '') after.pop();
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
      return { additions: after.length - prefix - suffix, deletions: before.length - prefix - suffix };
    }

    function changesFromView(view) {
      if (view === null || view === undefined) return [];
      if (view.card === 'diff') return (view.diffs ?? []).map((diff) => ({
        path: diff.path,
        ...replacementCounts(diff.oldText, diff.newText),
        fragments: typeof diff.newText === 'string' && diff.newText.length <= 750_000
          && (diff.oldText === null || (typeof diff.oldText === 'string' && diff.oldText.length <= 750_000))
          ? [{ oldText: diff.oldText, newText: diff.newText }]
          : [],
      }));
      if (view.card === 'generic' && view.kind === 'edit') return (view.locations ?? []).map((location) => ({ path: location.path }));
      return [];
    }

    const turnChangesDefinition = {
      kind: 'desktop-turn-changes',
      match: (event) => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' };
        if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' };
        if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' };
        return null;
      },
      start: (_context, match) => ({ turn: match.event.data.turn, calls: new Map(), changes: [] }),
      update: (context, match) => {
        if (match.event.type === 'tool/call') {
          const calls = new Map(context.state.calls);
          calls.set(String(match.event.data.callId), match.view?.for === 'call' ? match.view.view : null);
          return { ...context.state, calls };
        }
        if (match.event.type !== 'tool/result' || match.event.data.message.content[0].isError === true) return context.state;
        const callId = String(match.event.data.message.source.callId);
        const resultView = match.view?.for === 'result' ? match.view.view : null;
        const view = changesFromView(resultView).length > 0 ? resultView : (context.state.calls.get(callId) ?? null);
        const additions = changesFromView(view).map((change) => ({ ...change, seq: match.event.seq }));
        return additions.length === 0 ? context.state : { ...context.state, changes: [...context.state.changes, ...additions] };
      },
      buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined ? null : ({
        kind: 'turn', turn: context.state.turn, key: 'desktop-turn-changes', value: { changes: context.state.changes },
      }),
    };

    function selectTurnChanges(owner) {
      const data = owner.turn.data.get('desktop-turn-changes');
      if (data === undefined) {
        const deliverables = owner.turn.data.get('deliverables');
        if (deliverables === undefined) return null;
        const paths = [];
        const seen = new Set();
        for (const produced of deliverables.produced) {
          if (produced.seq > owner.seq || seen.has(produced.path)) continue;
          seen.add(produced.path);
          paths.push({ path: produced.path });
        }
        return paths.length === 0 ? null : paths;
      }
      const byPath = new Map();
      for (const change of data.changes) {
        if (change.seq > owner.seq || typeof change.path !== 'string' || change.path === '') continue;
        const previous = byPath.get(change.path);
        byPath.set(change.path, {
          path: change.path,
          additions: previous === undefined ? change.additions : previous.additions === undefined || change.additions === undefined ? undefined : previous.additions + change.additions,
          deletions: previous === undefined ? change.deletions : previous.deletions === undefined || change.deletions === undefined ? undefined : previous.deletions + change.deletions,
          fragments: [...(previous?.fragments ?? []), ...(change.fragments ?? [])],
        });
      }
      const changes = [...byPath.values()];
      return changes.length === 0 ? null : changes;
    }

    function splitPath(path) {
      const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      return at < 0 ? { directory: '', name: path } : { directory: path.slice(0, at + 1), name: path.slice(at + 1) };
    }

    function normalizedLines(value) {
      const lines = value.replaceAll('\r\n', '\n').split('\n');
      if (lines.at(-1) === '') lines.pop();
      return lines;
    }

    function replacementHunk(oldText, newText) {
      const before = oldText === null ? [] : normalizedLines(oldText);
      const after = normalizedLines(newText);
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
      const start = Math.max(0, prefix - 3);
      const oldEnd = Math.min(before.length, before.length - suffix + 3);
      const newEnd = Math.min(after.length, after.length - suffix + 3);
      const oldCount = oldEnd - start;
      const newCount = newEnd - start;
      const oldStart = oldCount === 0 ? 0 : start + 1;
      const newStart = newCount === 0 ? 0 : start + 1;
      const rows = [];
      for (let index = start; index < prefix; index += 1) rows.push(` ${before[index]}`);
      for (let index = prefix; index < before.length - suffix; index += 1) rows.push(`-${before[index]}`);
      for (let index = prefix; index < after.length - suffix; index += 1) rows.push(`+${after[index]}`);
      for (let index = before.length - suffix; index < oldEnd; index += 1) rows.push(` ${before[index]}`);
      return rows.length === 0 ? '' : `@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@\n${rows.join('\n')}\n`;
    }

    function reviewIntent(change) {
      const hunks = (change.fragments ?? []).map((fragment) => replacementHunk(fragment.oldText, fragment.newText)).filter(Boolean);
      if (hunks.length === 0) return change.path;
      return {
        path: change.path,
        historicalDiff: {
          text: `diff --git a/${change.path} b/${change.path}\n--- a/${change.path}\n+++ b/${change.path}\n${hunks.join('')}`,
          additions: change.additions ?? 0,
          deletions: change.deletions ?? 0,
        },
      };
    }

    function TurnChanges({ matched: changes }) {
      const [expanded, setExpanded] = React.useState(false);
      const shown = expanded ? changes : changes.slice(0, 3);
      const hasStats = changes.some((change) => change.additions !== undefined);
      const additions = changes.reduce((total, change) => total + (change.additions ?? 0), 0);
      const deletions = changes.reduce((total, change) => total + (change.deletions ?? 0), 0);
      return React.createElement('section', { className: 'dsh-turn-changes', 'data-testid': 'desktop-turn-changes' },
        React.createElement('header', { className: 'dsh-turn-changes-header' },
          React.createElement('span', { className: 'dsh-turn-changes-icon', 'aria-hidden': 'true' }, '▣'),
          React.createElement('span', { className: 'dsh-turn-changes-heading' },
            React.createElement('strong', null, `本轮变更 ${String(changes.length)} 个文件`),
            hasStats && React.createElement('small', null,
              React.createElement('span', { className: 'dsh-turn-additions' }, `+${String(additions)}`),
              ' ',
              React.createElement('span', { className: 'dsh-turn-deletions' }, `−${String(deletions)}`),
            ),
          ),
          React.createElement('span', { className: 'dsh-turn-actions' },
            React.createElement(Button, {
              variant: 'outline', size: 'sm', className: 'dsh-turn-review',
              onClick: () => window.deepSeekYukiRyouReview?.openChangedFile(reviewIntent(changes[0])),
            }, '审核'),
          ),
        ),
        React.createElement('div', { className: 'dsh-turn-change-list' }, shown.map((change) => {
          const path = splitPath(change.path);
          return React.createElement('button', {
            type: 'button', className: 'dsh-turn-change-row', key: change.path, title: change.path,
            onClick: () => window.deepSeekYukiRyouReview?.openChangedFile(reviewIntent(change)),
          },
            React.createElement('span', { className: 'dsh-turn-change-path' },
              React.createElement('span', { className: 'dsh-turn-directory' }, path.directory), path.name,
            ),
            change.additions === undefined
              ? null
              : React.createElement('span', { className: 'dsh-turn-change-stats' },
                React.createElement('span', { className: 'dsh-turn-additions' }, `+${String(change.additions)}`),
                ' ',
                React.createElement('span', { className: 'dsh-turn-deletions' }, `−${String(change.deletions ?? 0)}`),
              ),
          );
        })),
        changes.length > 3 && React.createElement('button', {
          type: 'button', className: 'dsh-turn-show-more', onClick: () => setExpanded(!expanded),
        }, expanded ? '收起' : `再显示 ${String(changes.length - 3)} 个文件`, expanded ? '⌃' : '⌄'),
      );
    }

    function ProducedFilesRow({ paths, openFile }) {
      const shown = paths.slice(0, 6);
      return React.createElement('div', { className: 'dsh-produced-files' },
        React.createElement('span', { className: 'dsh-produced-label' }, '产物'),
        React.createElement('div', { className: 'dsh-produced-row' },
          shown.map((path) => React.createElement('button', {
            type: 'button', className: 'dsh-produced-file', key: path, title: path, onClick: () => openFile(path),
          }, splitPath(path).name)),
          paths.length > shown.length && React.createElement('span', { className: 'dsh-produced-more' }, `+ ${String(paths.length - shown.length)} 个文件`),
        ),
      );
    }

    function ProducedFilesWithChanges(props) {
      const paths = props.matched.map((change) => change.path);
      const cwd = props.useSessions((snapshot) => snapshot.byId[props.sessionId]?.cwd);
      const reviewChanges = props.matched.map((change) => ({ ...change, path: relativeToWorkspace(change.path, cwd) }));
      return React.createElement(React.Fragment, null,
        React.createElement(ProducedFilesRow, { paths, openFile: props.openFile }),
        React.createElement(TurnChanges, { matched: reviewChanges }),
      );
    }

    function relativeToWorkspace(path, cwd) {
      if (typeof cwd !== 'string' || cwd === '') return path;
      const normalizedRoot = cwd.replaceAll('\\', '/').replace(/\/$/, '');
      const normalizedPath = path.replaceAll('\\', '/');
      return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : path;
    }

    function installStyle() {
      if (document.querySelector('style[data-dsh-desktop-companion-style]')) return;
      const style = document.createElement('style');
      style.dataset.dshDesktopCompanionStyle = '';
      style.textContent = `.dsh-produced-files{display:grid;margin-top:16px;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px 8px;font-size:13px;line-height:22px}.dsh-produced-label,.dsh-produced-more{color:var(--dsw-alias-label-tertiary)}.dsh-produced-row{display:flex;min-width:0;gap:8px;overflow:hidden}.dsh-produced-file{max-width:320px;padding:0 8px;overflow:hidden;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;font:inherit;text-overflow:ellipsis;white-space:nowrap}.dsh-produced-file:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dsh-turn-changes{margin-top:16px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}.dsh-turn-changes-header{display:flex;min-height:58px;padding:10px 14px;align-items:center;gap:11px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-turn-changes-icon{display:grid;width:34px;height:34px;flex:none;border-radius:9px;place-items:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);font-size:15px}.dsh-turn-changes-heading{display:flex;min-width:0;flex:1;flex-direction:column;line-height:20px}.dsh-turn-changes-heading strong{overflow:hidden;font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.dsh-turn-changes-heading small{font-size:12px}.dsh-turn-additions{color:var(--dsw-alias-green-label,#079447)}.dsh-turn-deletions{color:var(--dsw-alias-red-label,#c93736)}.dsh-turn-actions{display:flex;flex:none;align-items:center}.dsh-turn-change-list{padding:4px 0}.dsh-turn-change-row{display:flex;width:100%;height:40px;padding:0 16px;border:0;align-items:center;gap:12px;color:inherit;background:transparent;cursor:pointer;font:inherit;text-align:left}.dsh-turn-change-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-turn-change-row:focus-visible,.dsh-turn-show-more:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-border-l3);outline:none}.dsh-turn-change-path{min-width:0;flex:1;overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.dsh-turn-directory{color:var(--dsw-alias-label-tertiary)}.dsh-turn-change-stats{flex:none;font-size:12px}.dsh-turn-show-more{width:100%;height:36px;padding:0 16px;border:0;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;font:inherit;font-size:12px;text-align:left}.dsh-turn-show-more:hover{background:var(--dsw-alias-interactive-bg-hover)}`;
      document.head.append(style);
    }

    function installContextPublisher(ctx) {
      const bridge = window.deepSeekYukiRyouContext;
      if (bridge === undefined) return () => {};
      let revision = 0;
      let lastPayload = '';
      const publish = () => {
        const sessions = ctx.sessions.list.getSnapshot();
        const sessionId = sessions.current;
        const session = sessionId === undefined ? undefined : sessions.byId[sessionId];
        const workspace = sessionId === undefined
          ? undefined
          : ctx.workspaces.list.getSnapshot().items.find((item) => item.sessionIds.includes(sessionId));
        const next = {
          revision: revision + 1,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(workspace === undefined ? {} : { workspaceId: workspace.workspaceId }),
          running: session?.running === true,
        };
        const serialized = JSON.stringify({ ...next, revision: 0 });
        if (serialized === lastPayload) return;
        lastPayload = serialized;
        revision += 1;
        bridge.publish({ ...next, revision });
      };
      const disposeSessions = ctx.sessions.list.subscribe(publish);
      const disposeWorkspaces = ctx.workspaces.list.subscribe(publish);
      publish();
      return () => { disposeSessions(); disposeWorkspaces(); };
    }

    function WorkspaceReferenceReceiver(props) {
      const bridge = window.deepSeekYukiRyouComposer;
      React.useEffect(() => {
        const insert = (insertion) => {
          if (insertion.sessionId !== props.sessionId) return;
          const current = props.input.draft.replace(/\s+$/u, '');
          props.inputActions.setDraft(
            current === '' ? insertion.text : `${current}\n\n${insertion.text}`,
          );
        };
        const unsubscribe = bridge?.subscribe(props.sessionId, insert) ?? (() => {});
        const acceptsWorkspaceDrop = (event) => {
          const target = event.target;
          return event.dataTransfer?.types.includes('application/x-deepseek-workspace-reference') === true
            && typeof target?.closest === 'function'
            && target.closest('textarea,[contenteditable="true"]') !== null;
        };
        const onDragOver = (event) => {
          if (!acceptsWorkspaceDrop(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        };
        const onDrop = (event) => {
          if (!acceptsWorkspaceDrop(event)) return;
          let insertion;
          try {
            insertion = JSON.parse(event.dataTransfer.getData('application/x-deepseek-workspace-reference'));
          } catch {
            return;
          }
          if (
            insertion === null || typeof insertion !== 'object'
            || typeof insertion.sessionId !== 'string'
            || typeof insertion.text !== 'string' || insertion.text.length === 0
            || insertion.text.length > 18_432
          ) return;
          event.preventDefault();
          event.stopPropagation();
          insert(insertion);
        };
        window.addEventListener?.('dragover', onDragOver, true);
        window.addEventListener?.('drop', onDrop, true);
        return () => {
          unsubscribe();
          window.removeEventListener?.('dragover', onDragOver, true);
          window.removeEventListener?.('drop', onDrop, true);
        };
      }, [bridge, props.input.draft, props.inputActions, props.sessionId]);
      return null;
    }

    const inject = ['slots', 'sessions', 'workspaces', 'conversationEvents'];
    function apply(ctx) {
      installStyle();
      ctx.conversationEvents.register(turnChangesDefinition);
      ctx.effect(() => installContextPublisher(ctx), 'dsh-desktop: companion context publisher');
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
        {
          name: 'conversation.chat.turnTail',
          select: selectTurnChanges,
        },
        ProducedFilesWithChanges,
      ));
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'desktop-workspace-reference-receiver',
          order: 1_000,
          label: 'Desktop workspace references',
        },
        WorkspaceReferenceReceiver,
      ));
    }
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
