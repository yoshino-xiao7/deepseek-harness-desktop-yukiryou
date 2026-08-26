export type RuntimeSlotKind = 'single' | 'list' | 'chain';
export type RuntimeSlotScope = 'root' | 'session-maybe' | 'session';

export interface RuntimeSlotContract {
  readonly key: string;
  readonly purpose: string;
  readonly kind: RuntimeSlotKind;
  readonly scope: RuntimeSlotScope;
  readonly ownerProps: readonly string[];
  readonly occupant: readonly string[];
  readonly declaredBy: string;
  readonly replaceRisk: 'none' | 'shadows-shipped-ui';
  readonly childSlots: readonly string[];
}

/**
 * Contract verified against the dsh 0.1.1-rc.2 CLIENT_SLOT_API catalog.
 * This checked-in copy keeps unit tests independent from the gitignored vendored
 * Runtime; runtime:verify remains responsible for proving the pinned Runtime.
 */
export const RUNTIME_DESKTOP_SLOT_CONTRACT = [
  {
    key: 'root',
    purpose: 'The built-in render-tree root hole and ancestor of every other seat.',
    kind: 'single',
    scope: 'root',
    ownerProps: ['children?: never'],
    occupant: ['client-ui-layout AppFrame'],
    declaredBy: 'runtime',
    replaceRisk: 'shadows-shipped-ui',
    childSlots: ['sidebar', 'conversation', 'details', 'shell.overlay'],
  },
  {
    key: 'sidebar',
    purpose: 'The whole left column.',
    kind: 'single',
    scope: 'root',
    ownerProps: ['collapsed: boolean', 'width: number'],
    occupant: ['client-ui-sidebar SidebarRoot'],
    declaredBy: 'root',
    replaceRisk: 'shadows-shipped-ui',
    childSlots: [
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'sidebar.workspaces',
      'sidebar.settings',
      'sidebar.footer.action',
    ],
  },
  {
    key: 'conversation',
    purpose: 'The whole center column across no-session and live-session states.',
    kind: 'single',
    scope: 'session-maybe',
    ownerProps: [],
    occupant: ['client-ui-conversation ConversationRoot'],
    declaredBy: 'root',
    replaceRisk: 'shadows-shipped-ui',
    childSlots: [
      'conversation.session',
      'conversation.session.header',
      'conversation.composer',
      'conversation.composer.bar',
      'conversation.input.overlay',
      'conversation.input.dock',
      'conversation.composer.dock',
      'conversation.input.left',
      'conversation.input.right',
      'conversation.hero.brand.mark',
      'conversation.hero.workspace',
      'conversation.hero.agentPreset',
    ],
  },
  {
    key: 'details',
    purpose: 'The right details column shown when layout opens it.',
    kind: 'single',
    scope: 'session',
    ownerProps: [],
    occupant: ['client-ui-conversation DetailsPanel'],
    declaredBy: 'root',
    replaceRisk: 'shadows-shipped-ui',
    childSlots: ['conversation.details.tool'],
  },
  {
    key: 'shell.overlay',
    purpose: 'A frame-wide additive floating layer outside column scroll containers.',
    kind: 'list',
    scope: 'root',
    ownerProps: [],
    occupant: [],
    declaredBy: 'root',
    replaceRisk: 'none',
    childSlots: [],
  },
  {
    key: 'conversation.details.tool',
    purpose: 'The complete tool-output body inside the official details panel.',
    kind: 'single',
    scope: 'session',
    ownerProps: ['block', 'cwd'],
    occupant: ['client-ui-tool ToolDetails'],
    declaredBy: 'details',
    replaceRisk: 'shadows-shipped-ui',
    childSlots: [],
  },
  {
    key: 'settings.section',
    purpose: 'One additive settings page per list entry.',
    kind: 'list',
    scope: 'root',
    ownerProps: ['close: () => void'],
    occupant: [
      "client-ui-agent-preset AgentPresetSection id 'agent-presets'",
      "client-ui-settings-general GeneralSection id 'general'",
      "client-ui-settings-models ModelsSection id 'models'",
      "client-ui-settings-plugins PluginsSettingsSection id 'plugins'",
    ],
    declaredBy: 'sidebar.settings',
    replaceRisk: 'none',
    childSlots: ['settings.general.item', 'settings.plugins.tab'],
  },
  {
    key: 'settings.general.item',
    purpose: 'One additive row inside the built-in General settings section.',
    kind: 'list',
    scope: 'root',
    ownerProps: ['children?: never'],
    occupant: [],
    declaredBy: 'settings.section general entry',
    replaceRisk: 'none',
    childSlots: [],
  },
  {
    key: 'settings.plugins.tab',
    purpose: 'One additive page inside the built-in Plugins settings section.',
    kind: 'list',
    scope: 'root',
    ownerProps: ['children?: never'],
    occupant: [
      "client-ui-settings-plugin-inventory PluginInventorySettingsTab id 'all'",
      "client-ui-settings-plugins ConfigurablePluginsTab id 'configurable'",
    ],
    declaredBy: 'settings.section plugins entry',
    replaceRisk: 'none',
    childSlots: [],
  },
  {
    key: 'sidebar.footer.action',
    purpose: 'Optional additive actions beside Settings at the sidebar foot.',
    kind: 'list',
    scope: 'root',
    ownerProps: ['wide: boolean'],
    occupant: ["client-ui-cordis CordisPanel id 'cordis-panel'"],
    declaredBy: 'sidebar',
    replaceRisk: 'none',
    childSlots: [],
  },
  {
    key: 'conversation.chat.turnTail',
    purpose: 'The completed Turn Node additive extension chain.',
    kind: 'chain',
    scope: 'session',
    ownerProps: ['turn', 'seq', 'openFile'],
    occupant: [],
    declaredBy: 'conversation.chat.node:turn-tail',
    replaceRisk: 'none',
    childSlots: [],
  },
  {
    key: 'conversation.input.dock',
    purpose: 'Additive full-width rows above the official conversation composer.',
    kind: 'list',
    scope: 'session',
    ownerProps: ['session', 'input', 'sessionId', 'inputActions'],
    occupant: [],
    declaredBy: 'conversation',
    replaceRisk: 'none',
    childSlots: [],
  },
] as const satisfies readonly RuntimeSlotContract[];

export function runtimeSlotContract(key: string): RuntimeSlotContract {
  const contract = RUNTIME_DESKTOP_SLOT_CONTRACT.find((entry) => entry.key === key);
  if (contract === undefined) throw new Error(`Unknown Runtime desktop slot: ${key}`);
  return contract;
}
