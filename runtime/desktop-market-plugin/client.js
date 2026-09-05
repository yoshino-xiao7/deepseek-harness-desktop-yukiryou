/* global document, fetch, URLSearchParams, window */

window.__ModuleLoader__.load({
  id: '@dsh-desktop/market',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const namespace = 'settings.desktopMarket';
    const route = '/plugins/@dsh-desktop/market/catalog';
    const sourcesRoute = '/plugins/@dsh-desktop/market/sources';
    const inspectionRoute = '/plugins/@dsh-desktop/market/install-inspection';
    const updateCheckRoute = '/plugins/@dsh-desktop/market/update-check';
    const pageSize = 20;
    const dictionaries = {
      zh: {
        tab: '插件市场', title: '社区插件市场',
        description: '发现社区项目、了解来源与本机安装状态。目录收录只表示可发现，不代表官方认可或安全审核。',
        readonly: '通过全部核验的候选可使用受管安装；回执匹配的受管插件可安全启用、停用、回滚和卸载。社区插件将与 Harness 共享本机用户权限，所有配置变更都必须经过系统原生确认。',
        discover: '发现', installable: '可安装', installed: '已安装', sources: '来源',
        search: '搜索名称、作者、简介或分类', allCategories: '全部分类', refresh: '刷新',
        loading: '正在读取社区目录…', empty: '没有匹配的社区项目。', unavailable: '暂时无法读取社区目录。',
        rateLimited: 'GitHub 查询额度暂时用尽，请稍后重试。', retry: '重试', details: '查看详情',
        repository: '查看仓库', source: '来源', observed: '读取时间', publisher: '发布者声明',
        categories: '分类', noSummary: '该项目没有提供简介。', close: '关闭', trustTitle: '信任提示',
        trust: '远程目录只提供未经信任的展示信息。打开仓库或未来安装前，请自行确认作者、代码和许可。',
        curatedTrust: '此精确版本曾由 YukiRyou 实机安装测试，但这不是代码审计或绝对安全保证。安装前仍会执行完整包体、依赖、脚本、完整性和 Runtime 兼容性预检。',
        developmentTrust: '这是应用内置的开发测试包体，只用于验证安装链，不包含业务功能，也不会出现在正式发行版。',
        installableEmpty: '当前来源只提供发现信息，没有满足精确 npm 身份与来源证据要求的可安装候选。',
        installableHelp: '“可安装”只是结构资格，不代表代码安全。列表显示社区目录记录版本；打开详情后可选择目录版本或 npm 最新版本，安装前都必须通过完整安全预检。',
        installedLoading: '正在读取本机插件状态…', installedError: '暂时无法读取本机插件状态。',
        installedEmpty: '当前 Runtime 没有可显示的插件。', installedUserEmpty: '当前没有自行安装的插件。', active: '已启用', disabled: '已停用',
        installedScope: '安装来源', installedUser: '自行安装', installedSystem: '系统与依赖', installedAll: '全部（含系统）',
        installedVersion: '已安装版本', installedOwnership: '安装类型', installedState: '运行状态',
        installedMetadataUnavailable: '当前来源中没有找到该插件的远程简介；以下仍会显示本机安装信息。',
        recoverySkipped: '恢复模式中已跳过',
        externalUpdateUnsupported: '此安装缺少可验证的更新身份，或使用本地/开发来源，暂不支持市场自动更新。',
        externalUpdateAdoption: '更新后由桌面应用管理，无需先卸载。失败会恢复旧安装；已停用的插件保持停用。',
        system: '系统', dependency: '依赖', managed: '受管安装', external: '外部', readonlyState: '只读状态',
        runtimeUnavailable: 'Runtime 未加载', installedAt: '安装于 {time}', blockedAttempt: '已自动恢复失败版本 {version}', externalState: '外部可管理',
        uninstall: '卸载', uninstalling: '正在卸载…', uninstallUnavailable: '卸载状态已变化，请刷新后重试。',
        enablePlugin: '启用', disablePlugin: '停用', changingPlugin: '正在应用…', enabledUnavailable: '启用状态已变化，请刷新后重试。', managedState: '受管状态',
        rollbackPlugin: '回滚', rollingBack: '正在回滚…', rollbackUnavailable: '回滚目标已变化，请刷新后重试。', rollbackTarget: '可回滚至 {version}',
        sourceActive: '当前来源', sourceBuiltIn: '内置 Adapter', sourceProvider: '提供方', sourceSelect: '选择来源',
        sourceComplete: '当前来源完整索引', sourceTruncated: '当前来源截断索引', sourceIndexed: '已索引 {indexed} / 来源报告 {total}',
        cacheNetwork: '刚刚从来源同步', cachePersistent: '已从持久缓存快速载入 · {time}', cacheDevelopment: '本地开发测试数据',
        cacheStale: '正在显示过期缓存，后台更新不影响当前使用 · {time}', catalogRefreshing: '正在后台更新当前来源…',
        source1024Description: '结构化社区目录快照；当前响应少于来源报告总数，因此按截断来源处理，不生成可安装候选。',
        sourceDshfindDescription: '支持稳定数据版本的分页目录；Host 固定同一版本遍历全部页面后才发布本地索引。首次同步可能需要数分钟。',
        sourceYukiRyouName: 'YukiRyou · 实机验证',
        sourceYukiRyouDescription: '由 YukiRyou 远程维护的实机安装测试清单；更新目录无需重新发布桌面端，所有安装仍必须通过 Host 安全预检。',
        sourceGithubDescription: 'GitHub Topic 热门项目预览；受 GitHub 搜索窗口限制，不代表完整目录。',
        sourceDevelopmentDescription: '仅开发版可见的本地受控插件；不访问 npm，用于验证安全预检、安装、重启和自动恢复。',
        completeIndexHelp: 'Host 已读取并校验当前来源的完整目录；搜索、分类和分页基于完整本地索引。',
        truncatedIndexHelp: '该来源只返回有限结果，不能代表完整市场，也不会产生可安装候选。',
        sourceNotice: '同一时间只浏览一个来源。自定义来源只提供发现信息，不会直接获得安装资格。',
        sourceCustomDescription: '用户添加的标准 JSON v1 目录；Host 会校验 HTTPS 网络目标、响应预算和每一条记录。',
        sourceAddTitle: '添加自定义来源', sourceName: '来源名称', sourceUrl: 'HTTPS 目录地址', sourceAdd: '添加来源',
        sourceEnable: '启用', sourceDisable: '停用', sourceRemove: '移除', sourceUp: '上移', sourceDown: '下移',
        sourceDisabled: '已停用', sourceMutationError: '无法保存来源，请检查地址是否重复或格式是否正确。',
        developerVerification: '开发者验证', verifiedPlatforms: '平台', verifiedHarness: 'Harness', verifiedAt: '验证时间',
        previous: '上一页', next: '下一页', page: '第 {current} / {total} 页', items: '{count} 项',
        inspect: '安全预检', checkUpdates: '检查更新', inspectionTitle: '安装前安全预检', inspectionLoading: '正在解析所选版本、冻结依赖图并核验全部包体…',
        updateChecking: '正在直接查询 npm 最新稳定版本…', updateCheckUnavailable: '暂时无法查询 npm 最新版本；本机插件状态不受影响。', updateLatest: 'npm 最新版本', updateCurrent: '当前已是最新稳定版本', updateFound: '发现稳定版本 {version}', updateCatalogRequired: '应用更新仍需恢复对应目录证据并通过完整安全预检。',
        versionChoiceTitle: '安装版本', catalogVersionChoice: '安装目录版本', catalogVersionChoiceHelp: '严格安装社区目录当前记录的 {version}', latestVersionChoice: '安装最新版本', latestVersionChoiceHelp: '对账 npm latest 后安装最新稳定版本',
        inspectionLoadingDevelopment: '正在核验内置测试包体并生成冻结安装锁…',
        inspectionVerified: '依赖、Runtime 与实际包体校验通过', inspectionBlocked: '当前包或其依赖被安全策略阻止',
        inspectionUnavailable: '暂时无法完成安全预检，请稍后重试。', inspectionNoInstall: '实际包体、内容寻址缓存与 frozen lock 已核验。继续后会生成短期一次性安装预览；最终执行仍需在系统原生确认框中确认。', inspectionNoInstallBlocked: '前置检查尚未全部通过，实际包体与 frozen lock 未生成；当前结果只用于解释阻断原因，不会产生安装操作。',
        inspectionPackage: '精确包', inspectionPlatform: '目标平台', inspectionDependencies: '直接依赖 / Peer', inspectionGraph: '依赖图', inspectionPeers: 'Peer 结果', inspectionArtifacts: '已验证包体',
        prepareInstall: '准备安装', prepareAdopt: '安全预检并接管', prepareUpdate: '准备应用版本', prepareReinstall: '准备重新安装', preparingInstall: '正在生成受管变更预览…', installPreviewTitle: '受管安装摘要', updatePreviewTitle: '受管版本变更摘要', reinstallPreviewTitle: '受管重装摘要',
        installSize: '压缩 / 解包大小', installFiles: '文件数', installGraph: '依赖图', installValidity: '有效期',
        installValidityValue: '约 {minutes} 分钟', installPermissionWarning: '插件与 Harness 共享当前用户权限。确认后应用会重启并试运行新配置；启动失败会自动恢复。',
        currentVersion: '当前版本', catalogVersion: '目录记录版本', catalogVersionInline: '目录版本 {version}', latestVersion: 'npm 最新版本', upToDate: '当前已是所选版本', updateAvailable: '发现可用更新', installAndRestart: '安装并重启', updateAndRestart: '应用版本并重启', reinstallAndRestart: '重新安装并重启', adoptAndRestart: '接管并重启', adoptPreviewTitle: '接管外部安装', installCancelled: '已取消操作，当前预览仍可再次确认。', installPrepared: '插件配置已准备完成，正在重启…',
        installUnavailable: '安装预览已失效或 Runtime 状态发生变化，请重新准备。',
        peerMissing: 'Runtime 缺少', peerIncompatible: '版本不兼容', peerAmbiguous: '提供者不唯一', peerRequired: '需要', peerAvailable: '当前',
        checkExactIdentity: '目录与 npm 精确身份', checkRepository: '仓库回链', checkDeprecated: '废弃状态',
        checkLifecycleScripts: '安装生命周期脚本', checkIntegrity: 'SHA-512 完整性', checkTarballOrigin: '官方 tarball 来源',
        checkPlatform: '平台约束', checkDshBundle: 'DSH bundle 声明', checkNodeEngine: 'Node 兼容性', checkDependencyGraph: '完整依赖图', checkPeerCompatibility: 'Peer 运行时兼容性', checkArtifactBytes: '实际 tarball 字节', checkFrozenLock: '冻结安装锁',
        checkBundledFixtureOrigin: '受控本地包体来源',
      },
      en: {
        tab: 'Plugin market', title: 'Community plugin market',
        description: 'Discover community projects, inspect provenance, and understand local plugin state. Listing is not endorsement or a security review.',
        readonly: 'Verified candidates can use managed installation. Receipt-owned plugins can be safely enabled, disabled, rolled back, and uninstalled. Every profile change requires native system confirmation.',
        discover: 'Discover', installable: 'Installable', installed: 'Installed', sources: 'Sources',
        search: 'Search name, publisher, summary, or category', allCategories: 'All categories', refresh: 'Refresh',
        loading: 'Reading community catalog…', empty: 'No matching community projects.', unavailable: 'The community catalog is temporarily unavailable.',
        rateLimited: 'The GitHub search allowance is temporarily exhausted. Try again later.', retry: 'Retry', details: 'View details',
        repository: 'View repository', source: 'Source', observed: 'Observed', publisher: 'Publisher claim',
        categories: 'Categories', noSummary: 'No description was provided.', close: 'Close', trustTitle: 'Trust notice',
        trust: 'Remote catalogs provide untrusted display metadata only. Review the author, code, and license before opening a repository or installing in the future.',
        curatedTrust: 'YukiRyou installed and tested this exact version on real hardware. This is not a code audit or an absolute safety guarantee; the full artifact, dependency, script, integrity, and Runtime compatibility inspection still applies.',
        developmentTrust: 'This app-bundled development fixture only verifies the install chain. It has no product behavior and is absent from packaged releases.',
        installableEmpty: 'The current source provides discovery metadata only. No entry satisfies the exact npm identity and provenance evidence required for an installable candidate.',
        installableHelp: 'Installable is structural eligibility, not proof of safety. The list shows the community catalog version; open the details to choose the catalog version or npm latest, both of which must pass the full safety inspection before installation.',
        installedLoading: 'Reading local plugin state…', installedError: 'Local plugin state is temporarily unavailable.',
        installedEmpty: 'The current Runtime has no visible plugins.', installedUserEmpty: 'No user-installed plugins were found.', active: 'Enabled', disabled: 'Disabled',
        installedScope: 'Install source', installedUser: 'User installed', installedSystem: 'System and dependencies', installedAll: 'All (including system)',
        installedVersion: 'Installed version', installedOwnership: 'Install type', installedState: 'Runtime state',
        installedMetadataUnavailable: 'No remote description was found in the recorded source. Local installation details are still shown below.',
        recoverySkipped: 'Skipped during recovery',
        externalUpdateUnsupported: 'This installation lacks a verifiable update identity or uses a local/development source. Market updates are unavailable.',
        externalUpdateAdoption: 'The desktop will manage updates after adoption; no uninstall is needed. Failure restores the old installation. Disabled plugins stay disabled.',
        system: 'System', dependency: 'Dependency', managed: 'Managed install', external: 'External', readonlyState: 'Read-only state',
        runtimeUnavailable: 'Not loaded by Runtime', installedAt: 'Installed {time}', blockedAttempt: 'Recovered failed version {version}', externalState: 'Controllable external',
        uninstall: 'Uninstall', uninstalling: 'Uninstalling…', uninstallUnavailable: 'Plugin state changed. Refresh and try again.',
        enablePlugin: 'Enable', disablePlugin: 'Disable', changingPlugin: 'Applying…', enabledUnavailable: 'Enabled state changed. Refresh and try again.', managedState: 'Managed state',
        rollbackPlugin: 'Roll back', rollingBack: 'Rolling back…', rollbackUnavailable: 'The rollback target changed. Refresh and try again.', rollbackTarget: 'Can roll back to {version}',
        sourceActive: 'Current source', sourceBuiltIn: 'Bundled adapter', sourceProvider: 'Provider', sourceSelect: 'Select source',
        sourceComplete: 'Complete index for current source', sourceTruncated: 'Truncated index for current source', sourceIndexed: 'Indexed {indexed} / provider reports {total}',
        cacheNetwork: 'Just synchronized from the source', cachePersistent: 'Loaded quickly from persistent cache · {time}', cacheDevelopment: 'Local development test data',
        cacheStale: 'Showing stale cache while background refresh stays non-blocking · {time}', catalogRefreshing: 'Refreshing the current source in the background…',
        source1024Description: 'A structured community snapshot. Its response is smaller than the provider-reported total, so it is treated as truncated and produces no installable candidates.',
        sourceDshfindDescription: 'A versioned paginated catalog. The Host pins one data version and scans every page before publishing the local index. Initial sync may take several minutes.',
        sourceYukiRyouName: 'YukiRyou · Hardware tested',
        sourceYukiRyouDescription: 'A remotely maintained list of exact versions installed and tested by YukiRyou. Catalog updates do not require a desktop release, and every install still passes Host safety inspection.',
        sourceGithubDescription: 'A popular-project preview from the GitHub topic. The GitHub search window means this is not a complete catalog.',
        sourceDevelopmentDescription: 'A controlled local plugin visible only in development. It avoids npm and verifies inspection, installation, restart, and recovery.',
        completeIndexHelp: 'The Host has read and validated the complete catalog. Search, categories, and pagination use the full local index.',
        truncatedIndexHelp: 'This source returns limited results. It is not the complete market and cannot produce installable candidates.',
        sourceNotice: 'Only one source is browsed at a time. Custom sources are discovery-only and do not gain install eligibility.',
        sourceCustomDescription: 'A user-added standard JSON v1 catalog. The Host validates HTTPS networking, response budgets, and every record.',
        sourceAddTitle: 'Add custom source', sourceName: 'Source name', sourceUrl: 'HTTPS catalog URL', sourceAdd: 'Add source',
        sourceEnable: 'Enable', sourceDisable: 'Disable', sourceRemove: 'Remove', sourceUp: 'Move up', sourceDown: 'Move down',
        sourceDisabled: 'Disabled', sourceMutationError: 'Could not save the source. Check the URL format and duplicates.',
        developerVerification: 'Developer verification', verifiedPlatforms: 'Platforms', verifiedHarness: 'Harness', verifiedAt: 'Verified',
        previous: 'Previous', next: 'Next', page: 'Page {current} / {total}', items: '{count} items',
        inspect: 'Safety inspection', checkUpdates: 'Check for updates', inspectionTitle: 'Pre-install safety inspection', inspectionLoading: 'Resolving the selected version, freezing the dependency graph, and verifying every artifact…',
        updateChecking: 'Checking npm latest stable directly…', updateCheckUnavailable: 'npm latest is temporarily unavailable. The local plugin state is unchanged.', updateLatest: 'npm latest', updateCurrent: 'This is the latest stable version', updateFound: 'Stable version {version} is available', updateCatalogRequired: 'Applying it still requires catalog provenance and the complete safety inspection.',
        versionChoiceTitle: 'Install version', catalogVersionChoice: 'Install catalog version', catalogVersionChoiceHelp: 'Install the exact version currently recorded by the catalog: {version}', latestVersionChoice: 'Install latest version', latestVersionChoiceHelp: 'Resolve npm latest and install the newest stable version',
        inspectionLoadingDevelopment: 'Verifying the bundled test artifact and creating a frozen install lock…',
        inspectionVerified: 'Dependencies, Runtime, and artifact bytes passed', inspectionBlocked: 'The package or one of its dependencies is blocked by safety policy',
        inspectionUnavailable: 'The safety inspection is temporarily unavailable. Try again later.', inspectionNoInstall: 'Artifact bytes, the content-addressed cache, and frozen lock are verified. Continuing creates a short-lived one-time preview; execution still requires native system confirmation.', inspectionNoInstallBlocked: 'Prerequisite checks did not all pass, so artifact bytes and the frozen lock were not produced. This result only explains the blockers and cannot install anything.',
        inspectionPackage: 'Exact package', inspectionPlatform: 'Target platform', inspectionDependencies: 'Direct / peer dependencies', inspectionGraph: 'Dependency graph', inspectionPeers: 'Peer result', inspectionArtifacts: 'Verified artifacts',
        prepareInstall: 'Prepare install', prepareAdopt: 'Verify and adopt', prepareUpdate: 'Prepare selected version', prepareReinstall: 'Prepare reinstall', preparingInstall: 'Preparing a managed change preview…', installPreviewTitle: 'Managed install summary', updatePreviewTitle: 'Managed version change summary', reinstallPreviewTitle: 'Managed reinstall summary',
        installSize: 'Compressed / unpacked', installFiles: 'Files', installGraph: 'Dependency graph', installValidity: 'Valid for',
        installValidityValue: 'About {minutes} min', installPermissionWarning: 'The plugin shares the current user privileges with Harness. After confirmation the app restarts in trial mode and recovers automatically if startup fails.',
        currentVersion: 'Current version', catalogVersion: 'Catalog version', catalogVersionInline: 'Catalog version {version}', latestVersion: 'npm latest', upToDate: 'The selected version is already installed', updateAvailable: 'An update is available', installAndRestart: 'Install and restart', updateAndRestart: 'Apply version and restart', reinstallAndRestart: 'Reinstall and restart', adoptAndRestart: 'Adopt and restart', adoptPreviewTitle: 'Adopt external installation', installCancelled: 'The operation was cancelled. This preview can still be confirmed again.', installPrepared: 'The plugin profile is ready. Restarting…',
        installUnavailable: 'The preview expired or Runtime state changed. Prepare it again.',
        peerMissing: 'Missing from Runtime', peerIncompatible: 'Incompatible version', peerAmbiguous: 'Ambiguous provider', peerRequired: 'requires', peerAvailable: 'available',
        checkExactIdentity: 'Catalog and npm identity', checkRepository: 'Repository backlink', checkDeprecated: 'Deprecation status',
        checkLifecycleScripts: 'Install lifecycle scripts', checkIntegrity: 'SHA-512 integrity', checkTarballOrigin: 'Official tarball origin',
        checkPlatform: 'Platform constraints', checkDshBundle: 'DSH bundle declaration', checkNodeEngine: 'Node compatibility', checkDependencyGraph: 'Complete dependency graph', checkPeerCompatibility: 'Peer runtime compatibility', checkArtifactBytes: 'Actual tarball bytes', checkFrozenLock: 'Frozen install lock',
        checkBundledFixtureOrigin: 'Controlled local artifact origin',
      },
    };

    const css = `
      .dsh-market-page{box-sizing:border-box;width:min(860px,100%);padding:8px 4px 32px;color:var(--dsw-alias-label-primary)}
      .dsh-market-page h2{margin:0;font-size:20px;font-weight:600;line-height:30px}
      .dsh-market-description{margin:6px 0 12px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
      .dsh-market-notice{margin-bottom:14px;padding:11px 13px;border:1px solid rgb(77 107 254 / 24%);border-radius:11px;color:var(--dsw-alias-label-secondary);background:rgb(77 107 254 / 7%);font-size:12px;line-height:19px}
      .dsh-market-index-status{display:grid;margin:-4px 0 14px;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:2px 10px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
      .dsh-market-index-status strong{color:var(--dsw-alias-label-secondary);font-weight:550}
      .dsh-market-index-status span:nth-child(2){text-align:right}.dsh-market-index-status span:nth-child(n+3){grid-column:1/-1}.dsh-market-index-status span:last-child{text-align:left}
      .dsh-market-views{display:flex;margin-bottom:14px;overflow-x:auto;border-bottom:1px solid var(--dsw-alias-border-l2);gap:18px}
      .dsh-market-view{height:38px;border:0;border-bottom:2px solid transparent;padding:0 1px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
      .dsh-market-view[aria-selected="true"]{border-bottom-color:var(--dsw-static-deepseek-500,#4d6bfe);color:var(--dsw-static-deepseek-500,#4d6bfe);font-weight:600}
      .dsh-market-count{margin-left:5px;color:var(--dsw-alias-label-tertiary);font-size:10px}
      .dsh-market-toolbar{display:grid;margin-bottom:14px;grid-template-columns:minmax(0,1fr) 150px auto;gap:8px}
      .dsh-market-toolbar-search-only{grid-template-columns:minmax(0,1fr)}
      .dsh-market-toolbar-installed{grid-template-columns:minmax(0,1fr) 180px}
      .dsh-market-search,.dsh-market-select{box-sizing:border-box;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;outline:none;padding:0 12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:12px}
      .dsh-market-search:focus,.dsh-market-select:focus{border-color:var(--dsw-static-deepseek-500,#4d6bfe)}
      .dsh-market-button{height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 13px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;font-size:12px}
      .dsh-market-button:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
      .dsh-market-button:disabled{cursor:default;opacity:.45}
      .dsh-market-button.dsh-market-primary{border-color:var(--dsw-static-deepseek-500,#4d6bfe);color:#fff;background:var(--dsw-static-deepseek-500,#4d6bfe)}
      .dsh-market-button.dsh-market-primary:hover:not(:disabled){color:#fff;background:var(--dsw-static-deepseek-600,#4057d6)}
      .dsh-market-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .dsh-market-card{display:flex;min-width:0;min-height:158px;padding:14px;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-market-card-head{display:grid;grid-template-columns:38px minmax(0,1fr);gap:10px;align-items:center}
      .dsh-market-icon{position:relative;display:grid;width:38px;height:38px;overflow:hidden;flex:none;place-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-static-deepseek-500,#4d6bfe);background:rgb(77 107 254 / 9%);font-size:14px;font-weight:650;text-transform:uppercase}
      .dsh-market-icon img{position:absolute;width:100%;height:100%;inset:0;object-fit:cover;background:var(--dsw-alias-bg-layer-1)}
      .dsh-market-icon[data-large="true"]{width:48px;height:48px;border-radius:13px;font-size:17px}
      .dsh-market-card-title{min-width:0}
      .dsh-market-name{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
      .dsh-market-publisher{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
      .dsh-market-summary{display:-webkit-box;overflow:hidden;margin:8px 0 10px;-webkit-box-orient:vertical;-webkit-line-clamp:3;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .dsh-market-tags{display:flex;margin-top:auto;overflow:hidden;gap:5px}
      .dsh-market-tag{overflow:hidden;max-width:110px;border-radius:999px;padding:2px 7px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);font-size:10px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
      .dsh-market-footer{display:flex;margin-top:11px;padding-top:10px;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--dsw-alias-border-l2)}
      .dsh-market-source{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
      .dsh-market-link,.dsh-market-detail{flex:none;border:0;padding:0;color:var(--dsw-static-deepseek-500,#4d6bfe);background:transparent;cursor:pointer;font:inherit;font-size:11px;font-weight:550;text-decoration:none}
      .dsh-market-card-actions{display:flex;align-items:center;gap:12px}
      .dsh-market-message{padding:38px 12px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px;text-align:center}
      .dsh-market-message .dsh-market-button{display:block;margin:12px auto 0}
      .dsh-market-pagination{display:flex;margin-top:14px;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:11px}
      .dsh-market-panel{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-market-panel h3{margin:0 0 6px;font-size:15px}.dsh-market-panel p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
      .dsh-market-installed-row{display:grid;min-width:0;padding:14px 16px;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      button.dsh-market-installed-row{width:100%;color:inherit;cursor:pointer;font:inherit;text-align:left}
      .dsh-market-installed-identity{display:grid;min-width:0;gap:3px}.dsh-market-installed-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-market-installed-detail{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.dsh-market-installed-status{display:flex;align-items:center;justify-content:flex-end;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:10px;white-space:nowrap}.dsh-market-installed-list{display:grid;gap:8px}
      .dsh-market-installed-actions{display:flex;max-width:none;flex-wrap:wrap;justify-content:flex-end;gap:6px}.dsh-market-installed-actions .dsh-market-button{width:auto;height:30px;padding:0 9px;font-size:11px}
      .dsh-market-source-list{display:grid;gap:10px}.dsh-market-source-card{display:grid;padding:16px;grid-template-columns:minmax(0,1fr) auto;gap:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-market-source-card[data-selected="true"]{border-color:rgb(77 107 254 / 42%)}
      .dsh-market-source-card h3{margin:0 0 5px;font-size:15px}.dsh-market-source-card p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}.dsh-market-source-badge{align-self:start;border-radius:999px;padding:3px 8px;color:var(--dsw-static-deepseek-500,#4d6bfe);background:rgb(77 107 254 / 10%);font-size:10px;white-space:nowrap}
      .dsh-market-source-actions{display:flex;max-width:240px;flex-wrap:wrap;align-content:start;justify-content:flex-end;gap:6px}.dsh-market-source-actions .dsh-market-button{height:30px;padding:0 9px;font-size:11px}
      .dsh-market-source-card[data-enabled="false"]{opacity:.68}.dsh-market-source-url{overflow-wrap:anywhere}
      .dsh-market-source-form{display:grid;margin-bottom:12px;padding:14px;grid-template-columns:minmax(120px,.55fr) minmax(220px,1fr) auto;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-market-source-form h3{grid-column:1/-1;margin:0 0 2px;font-size:14px}.dsh-market-source-error{grid-column:1/-1;margin:0;color:var(--dsw-static-red-500,#e5484d);font-size:11px}
      .dsh-market-source-notice{margin-top:12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
      .dsh-market-modal-backdrop{position:fixed;z-index:1000;inset:0;display:grid;padding:24px;place-items:center;background:rgb(0 0 0 / 48%)}
      .dsh-market-modal{box-sizing:border-box;width:min(560px,100%);max-height:min(680px,calc(100vh - 48px));overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 60px rgb(0 0 0 / 28%)}
      .dsh-market-modal-head{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:12px}.dsh-market-modal h3{overflow-wrap:anywhere;margin:0;font-size:18px}.dsh-market-modal-close{width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;font-size:18px}
      .dsh-market-modal-summary{margin:14px 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px}.dsh-market-detail-grid{display:grid;margin:14px 0;grid-template-columns:100px minmax(0,1fr);gap:8px 12px;font-size:12px}.dsh-market-detail-grid dt{color:var(--dsw-alias-label-tertiary)}.dsh-market-detail-grid dd{overflow-wrap:anywhere;margin:0}
      .dsh-market-trust{margin:14px 0;padding:11px 12px;border-radius:10px;color:var(--dsw-alias-label-secondary);background:rgb(77 107 254 / 8%);font-size:11px;line-height:18px}.dsh-market-trust strong{display:block;margin-bottom:3px;color:var(--dsw-alias-label-primary)}
      .dsh-market-inspection{margin:14px 0;padding:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}.dsh-market-inspection h4{margin:0 0 8px;font-size:13px}.dsh-market-inspection-summary{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}.dsh-market-inspection-meta{display:grid;margin-bottom:10px;grid-template-columns:100px minmax(0,1fr);gap:5px 10px;color:var(--dsw-alias-label-secondary);font-size:11px}.dsh-market-inspection-meta strong{color:var(--dsw-alias-label-tertiary);font-weight:500}.dsh-market-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.dsh-market-check{display:flex;min-width:0;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:10px}.dsh-market-check::before{content:'…';display:grid;width:16px;height:16px;flex:none;place-items:center;border-radius:999px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}.dsh-market-check[data-state="pass"]::before{content:'✓';color:var(--dsw-static-green-500,#30a46c);background:rgb(48 164 108 / 12%)}.dsh-market-check[data-state="fail"]::before{content:'×';color:var(--dsw-static-red-500,#e5484d);background:rgb(229 72 77 / 12%)}.dsh-market-peer-issues{display:grid;margin:10px 0 0;padding:0;gap:6px;list-style:none}.dsh-market-peer-issue{min-width:0;padding:7px 9px;border:1px solid rgb(229 72 77 / 22%);border-radius:8px;background:rgb(229 72 77 / 7%);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px}.dsh-market-peer-issue strong{display:block;overflow:hidden;color:var(--dsw-alias-label-primary);font-weight:550;text-overflow:ellipsis;white-space:nowrap}
      .dsh-market-version-choice{display:grid;margin:0 0 12px;padding:0;border:0;gap:7px}.dsh-market-version-choice legend{margin-bottom:2px;color:var(--dsw-alias-label-tertiary);font-size:10px}.dsh-market-version-option{display:grid;padding:9px 10px;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;cursor:pointer;background:var(--dsw-alias-bg-layer-1)}.dsh-market-version-option:has(input:checked){border-color:rgb(77 107 254 / 48%);background:rgb(77 107 254 / 7%)}.dsh-market-version-option input{margin:2px 0 0;grid-row:1/3}.dsh-market-version-option strong{font-size:11px;font-weight:550}.dsh-market-version-option span{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
      .dsh-market-install-preview{margin-top:12px;padding:12px;border:1px solid rgb(77 107 254 / 28%);border-radius:10px;background:rgb(77 107 254 / 7%)}.dsh-market-install-preview h5{margin:0 0 8px;color:var(--dsw-alias-label-primary);font-size:12px}.dsh-market-install-preview .dsh-market-inspection-meta{margin-bottom:8px}.dsh-market-install-warning{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:17px}.dsh-market-install-status{margin:10px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}.dsh-market-install-actions{display:flex;align-items:center;gap:8px}
      @media(max-width:760px){.dsh-market-grid{grid-template-columns:1fr}.dsh-market-toolbar,.dsh-market-source-form{grid-template-columns:1fr}.dsh-market-button{width:100%}.dsh-market-installed-row{grid-template-columns:1fr}.dsh-market-installed-status,.dsh-market-installed-actions{justify-content:flex-start}.dsh-market-installed-actions .dsh-market-button{width:auto}.dsh-market-source-card{grid-template-columns:1fr}.dsh-market-source-actions{max-width:none;justify-content:flex-start}.dsh-market-modal-backdrop{padding:12px}}
    `;
    if (!document.querySelector('style[data-plugin-css="dsh-desktop-market"]')) {
      const style = document.createElement('style');
      style.dataset.pluginCss = 'dsh-desktop-market';
      style.textContent = css;
      document.head.appendChild(style);
    }

    async function readCatalog(refresh, sourceId) {
      const params = new URLSearchParams({ source: sourceId });
      if (refresh) params.set('refresh', '1');
      const response = await fetch(`${route}?${params.toString()}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || !Array.isArray(body.value?.items)) {
        const error = new Error('catalog unavailable');
        error.code = body?.error === 'rate-limited' ? 'rate-limited' : 'unavailable';
        throw error;
      }
      return body.value;
    }

    async function readSources() {
      const response = await fetch(sourcesRoute, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || !Array.isArray(body.value)) throw new Error('sources unavailable');
      return body.value;
    }

    async function readInstalledUpdate(packageName, installedVersion) {
      const params = new URLSearchParams({ packageName, installedVersion });
      const response = await fetch(`${updateCheckRoute}?${params.toString()}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || typeof body.value?.latestVersion !== 'string') {
        throw new Error(body?.error ?? 'update check unavailable');
      }
      return body.value;
    }

    async function mutateSources(operation) {
      const response = await fetch(sourcesRoute, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-dsh-desktop-market-mutation': '1' },
        body: JSON.stringify(operation),
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || !Array.isArray(body.value)) throw new Error(body?.error ?? 'source mutation failed');
      return body.value;
    }

    async function inspectInstall(identity) {
      const response = await fetch(inspectionRoute, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-dsh-desktop-market-inspection': '1' },
        body: JSON.stringify(identity),
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || body.value?.executionReady !== false) throw new Error(body?.error ?? 'inspection failed');
      return body.value;
    }

    function inferredOwnership(moduleName) {
      if (moduleName.startsWith('cordis:') || moduleName.startsWith('@deepseek-ai/cordis') || moduleName.startsWith('cordis-plugin-')) return 'dependency';
      if (moduleName.startsWith('@dsh-desktop/') || moduleName.startsWith('@deepseek-ai/dsh-')) return 'system';
      return 'external';
    }

    function mergeInstalledInventory(runtimeEntries, managedSnapshot) {
      const managed = new Map((managedSnapshot?.entries ?? []).map((entry) => [entry.packageName, entry]));
      const external = new Map((managedSnapshot?.externalEntries ?? []).flatMap((entry) =>
        entry.entryIds.map((entryId) => [entryId, entry])));
      const externalByPackage = new Map((managedSnapshot?.externalEntries ?? []).map((entry) =>
        [entry.packageName, entry]));
      const seenManaged = new Set();
      const entries = runtimeEntries.map((entry) => {
        const receipt = managed.get(entry.moduleName);
        const externalControl = external.get(entry.entryId) ?? externalByPackage.get(entry.moduleName);
        if (receipt !== undefined) seenManaged.add(receipt.packageName);
        return {
          ...entry,
          ownership: receipt === undefined ? inferredOwnership(entry.moduleName) : 'managed',
          runtimeState: receipt === undefined
            ? (entry.enabled ? 'active' : 'disabled')
            : receipt.enabled
              ? (entry.enabled ? 'active' : 'runtimeUnavailable')
              : 'disabled',
          receipt,
          externalControl,
          recoverySkipped: entry.enabled !== true && ((managedSnapshot?.recoveryMode === 'safe' && (receipt !== undefined || externalControl !== undefined)) ||
            managedSnapshot?.isolatedPackages?.includes(receipt?.packageName ?? externalControl?.packageName ?? entry.moduleName) === true),
        };
      });
      for (const receipt of managed.values()) {
        if (seenManaged.has(receipt.packageName)) continue;
        entries.push({
          entryId: `managed:${receipt.packageName}`,
          moduleName: receipt.packageName,
          enabled: false,
          ownership: 'managed',
          runtimeState: receipt.enabled ? 'runtimeUnavailable' : 'disabled',
          receipt,
          recoverySkipped: managedSnapshot?.recoveryMode === 'safe' || managedSnapshot?.isolatedPackages?.includes(receipt.packageName),
        });
      }
      for (const externalControl of externalByPackage.values()) {
        if (entries.some(entry => entry.externalControl?.packageName === externalControl.packageName)) continue;
        entries.push({ entryId: externalControl.entryIds[0], moduleName: externalControl.packageName,
          enabled: false, ownership: 'external', runtimeState: externalControl.enabled ? 'runtimeUnavailable' : 'disabled', externalControl, recoverySkipped: managedSnapshot?.recoveryMode === 'safe' || managedSnapshot?.isolatedPackages?.includes(externalControl.packageName) });
      }
      return entries;
    }

    function findInstalledCatalogItem(entry, items) {
      const packageName = entry.receipt?.packageName ?? entry.moduleName;
      const version = entry.receipt?.version;
      return items.find((item) => item.package?.name === packageName &&
        (version === undefined || item.package?.version === version))
        ?? items.find((item) => item.package?.name === packageName)
        ?? items.find((item) => item.package?.name === entry.moduleName || item.displayName === entry.moduleName);
    }

    function format(t, key, values) {
      let value = t(key);
      for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, String(replacement));
      return value;
    }

    function formatDateTime(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '—';
      const language = document.documentElement.lang?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
      return new Intl.DateTimeFormat(language, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date);
    }

    function formatBytes(value) {
      if (!Number.isFinite(value) || value < 0) return '—';
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
      return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    }

    function MarketIcon({ item, large = false }) {
      const fallback = String(item.displayName ?? '?').trim().slice(0, 1) || '?';
      return React.createElement('span', { className: 'dsh-market-icon', 'data-large': large },
        fallback,
        item.media?.icon && React.createElement('img', {
          src: item.media.icon, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer',
          onError: (event) => { event.currentTarget.style.display = 'none'; },
        }),
      );
    }

    function includesSearch(values, needle) {
      return needle === '' || values.some((value) =>
        String(value ?? '').toLocaleLowerCase().includes(needle));
    }

    function matchesCatalogSearch(item, needle) {
      return includesSearch([
        item.displayName, item.summary, item.publisher?.name, item.package?.name,
        item.package?.version, item.repository, ...item.categories,
      ], needle);
    }

    function matchesInstalledSearch(entry, needle) {
      return includesSearch([
        entry.entryId, entry.moduleName, entry.ownership, entry.runtimeState,
        entry.receipt?.packageName, entry.receipt?.version,
        entry.receipt?.rollbackTarget?.version,
      ], needle);
    }

    function matchesInstalledScope(entry, scope) {
      if (scope === 'all') return true;
      const systemOwned = entry.ownership === 'system' || entry.ownership === 'dependency';
      return scope === 'system' ? systemOwned : !systemOwned;
    }

    function CommunityMarketTab({ t, listInstalled }) {
      const [sourceId, setSourceId] = React.useState(() => {
        try { return window.localStorage.getItem('dsh.market.source') ?? 'dshfind'; } catch { return 'dshfind'; }
      });
      const [catalog, setCatalog] = React.useState({ status: 'loading', snapshot: null });
      const [inventory, setInventory] = React.useState({ status: 'loading', entries: [] });
      const [sourceRecords, setSourceRecords] = React.useState({ status: 'loading', entries: [] });
      const [view, setView] = React.useState('discover');
      const [installedScope, setInstalledScope] = React.useState('user');
      const [query, setQuery] = React.useState('');
      const [category, setCategory] = React.useState('all');
      const [page, setPage] = React.useState(1);
      const [selected, setSelected] = React.useState(null);
      const [selectedInstalled, setSelectedInstalled] = React.useState(null);
      const [selectedSource, setSelectedSource] = React.useState(null);
      const [sourceName, setSourceName] = React.useState('');
      const [sourceUrl, setSourceUrl] = React.useState('');
      const [sourceBusy, setSourceBusy] = React.useState(false);
      const [sourceError, setSourceError] = React.useState(false);
      const [inspection, setInspection] = React.useState({ status: 'idle', value: null });
      const [versionPreference, setVersionPreference] = React.useState('latest');
      const [managedInstall, setManagedInstall] = React.useState({ status: 'idle', value: null });
      const [managedRemove, setManagedRemove] = React.useState({ status: 'idle', packageName: null });
      const [managedActivation, setManagedActivation] = React.useState({ status: 'idle', packageName: null });
      const [managedRollback, setManagedRollback] = React.useState({ status: 'idle', packageName: null });
      const [updateCheck, setUpdateCheck] = React.useState({ status: 'idle', packageName: null, value: null });
      React.useEffect(() => {
        setVersionPreference('latest');
        setInspection({ status: 'idle', value: null });
        setManagedInstall({ status: 'idle', value: null });
      }, [selected?.id]);
      const load = React.useCallback((refresh = false) => {
        setCatalog((current) => ({ status: 'loading', snapshot: current.snapshot }));
        readCatalog(refresh, sourceId).then(
          (snapshot) => setCatalog({ status: 'ready', snapshot }),
          (error) => setCatalog((current) => current.snapshot === null
            ? { status: error.code === 'rate-limited' ? 'rate-limited' : 'error', snapshot: null }
            : { status: 'ready', snapshot: current.snapshot, refreshError: true }),
        );
        setInventory((current) => ({ status: 'loading', entries: current.entries }));
        listInstalled().then(
          async (value) => {
            let managedSnapshot = { entries: [] };
            try {
              const result = await window.deepSeekYukiRyouPlugins.inventory();
              if (result?.status === 'ready') managedSnapshot = result;
            } catch { /* the raw Runtime inventory remains useful */ }
            setInventory({ status: 'ready', entries: mergeInstalledInventory(value.entries, managedSnapshot) });
          },
          () => setInventory({ status: 'error', entries: [] }),
        );
        readSources().then(
          (entries) => {
            setSourceRecords({ status: 'ready', entries });
            const current = entries.find((entry) => entry.id === sourceId);
            if (sourceId !== 'dshfind' && (current === undefined || current.enabled === false)) selectSource('dshfind');
          },
          () => setSourceRecords({ status: 'error', entries: [] }),
        );
      }, [listInstalled, sourceId]);
      React.useEffect(() => load(false), [load]);
      const allItems = catalog.snapshot?.items ?? [];
      const needle = query.trim().toLocaleLowerCase();
      const categories = [...new Set(allItems.flatMap((item) => item.categories))].sort((left, right) => left.localeCompare(right));
      const filtered = allItems.filter((item) =>
        (category === 'all' || item.categories.includes(category)) &&
        matchesCatalogSearch(item, needle),
      );
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const currentPage = Math.min(page, totalPages);
      const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
      const installable = allItems.filter((item) => item.installability?.state === 'candidate');
      const filteredInstallable = installable.filter((item) => matchesCatalogSearch(item, needle));
      const installablePages = Math.max(1, Math.ceil(filteredInstallable.length / pageSize));
      const installablePage = Math.min(page, installablePages);
      const visibleInstallable = filteredInstallable.slice((installablePage - 1) * pageSize, installablePage * pageSize);
      const userInstalled = inventory.entries.filter((entry) => matchesInstalledScope(entry, 'user'));
      const scopedInstalled = inventory.entries.filter((entry) => matchesInstalledScope(entry, installedScope));
      const filteredInstalled = scopedInstalled.filter((entry) => matchesInstalledSearch(entry, needle));
      const installedPages = Math.max(1, Math.ceil(filteredInstalled.length / pageSize));
      const installedPage = Math.min(page, installedPages);
      const visibleInstalled = filteredInstalled.slice((installedPage - 1) * pageSize, installedPage * pageSize);
      const views = [
        ['discover', 'discover', allItems.length],
        ['installable', 'installable', installable.length],
        ['installed', 'installed', userInstalled.length],
        ['sources', 'sources', sourceRecords.entries.length],
      ];
      const selectView = (next) => { setView(next); setPage(1); };
      const searchControl = React.createElement('div', { className: 'dsh-market-toolbar dsh-market-toolbar-search-only' },
        React.createElement('input', {
          className: 'dsh-market-search', type: 'search', value: query,
          placeholder: t('search'), 'aria-label': t('search'),
          onChange: (event) => { setQuery(event.currentTarget.value); setPage(1); },
        }),
      );
      const installedToolbar = React.createElement('div', { className: 'dsh-market-toolbar dsh-market-toolbar-installed' },
        React.createElement('input', {
          className: 'dsh-market-search', type: 'search', value: query,
          placeholder: t('search'), 'aria-label': t('search'),
          onChange: (event) => { setQuery(event.currentTarget.value); setPage(1); },
        }),
        React.createElement('select', {
          className: 'dsh-market-select', value: installedScope, 'aria-label': t('installedScope'),
          onChange: (event) => { setInstalledScope(event.currentTarget.value); setPage(1); },
        },
        React.createElement('option', { value: 'user' }, t('installedUser')),
        React.createElement('option', { value: 'system' }, t('installedSystem')),
        React.createElement('option', { value: 'all' }, t('installedAll')),
        ),
      );
      const selectSource = (nextSourceId) => {
        try { window.localStorage.setItem('dsh.market.source', nextSourceId); } catch { /* storage may be unavailable */ }
        setSourceId(nextSourceId);
        setPage(1);
        setSelected(null);
        setSelectedInstalled(null);
        setSelectedSource(null);
        setInspection({ status: 'idle', value: null });
        setManagedInstall({ status: 'idle', value: null });
      };
      const closeDetails = () => {
        setSelected(null);
        setSelectedInstalled(null);
        setSelectedSource(null);
        setUpdateCheck({ status: 'idle', packageName: null, value: null });
      };
      const openCatalogDetails = (item) => {
        setSelected(item);
        setSelectedInstalled(null);
        setSelectedSource(catalog.snapshot?.source ?? null);
      };
      const openInstalledDetails = async (entry) => {
        setInspection({ status: 'idle', value: null });
        setManagedInstall({ status: 'idle', value: null });
        setVersionPreference('latest');
        const recordedSourceId = entry.receipt?.sourceId;
        const external = entry.externalControl;
        const fallback = {
          id: `installed:${entry.entryId}`,
          displayName: entry.moduleName,
          summary: '',
          categories: [],
          provenance: {
            sourceId: external === undefined ? (recordedSourceId ?? 'local-runtime') : 'external-installed',
            observedAt: entry.receipt?.installedAt,
          },
          ...(external === undefined ? { installability: { state: 'installed' } } : {
            repository: external.repository,
            package: { name: external.packageName, version: external.version },
            installability: external.updateUnavailableReason === undefined
              ? { state: 'candidate', reason: 'verified-external-installation' }
              : { state: 'unavailable', reason: external.updateUnavailableReason },
          }),
        };
        setSelected(fallback);
        setSelectedInstalled(entry);
        setSelectedSource(recordedSourceId === undefined
          ? { id: external === undefined ? 'local-runtime' : 'external-installed', displayName: t(external === undefined ? 'readonlyState' : 'externalState') }
          : { id: recordedSourceId, displayName: recordedSourceId });
        if (entry.receipt !== undefined || (entry.externalControl !== undefined && entry.externalControl.updateUnavailableReason === undefined)) {
          const packageName = entry.receipt?.packageName ?? entry.externalControl.packageName;
          const installedVersion = entry.receipt?.version ?? entry.externalControl.version;
          setUpdateCheck({ status: 'loading', packageName, value: null });
          readInstalledUpdate(packageName, installedVersion).then(
            (value) => setUpdateCheck((current) => current.packageName === packageName
              ? { status: 'ready', packageName, value }
              : current),
            () => setUpdateCheck((current) => current.packageName === packageName
              ? { status: 'error', packageName, value: null }
              : current),
          );
        } else setUpdateCheck({ status: 'idle', packageName: null, value: null });
        try {
          const snapshot = recordedSourceId !== undefined && catalog.snapshot?.source?.id !== recordedSourceId
            ? await readCatalog(false, recordedSourceId)
            : catalog.snapshot;
          const item = findInstalledCatalogItem(entry, snapshot?.items ?? []);
          if (item !== undefined && external === undefined) {
            setSelected(item);
            setSelectedSource(snapshot.source);
          }
        } catch { /* local installation details remain available */ }
      };
      const applySourceMutation = async (operation) => {
        setSourceBusy(true);
        setSourceError(false);
        try {
          const entries = await mutateSources(operation);
          setSourceRecords({ status: 'ready', entries });
          const current = entries.find((entry) => entry.id === sourceId);
          if (current === undefined || current.enabled === false) selectSource('dshfind');
          return true;
        } catch {
          setSourceError(true);
          return false;
        } finally {
          setSourceBusy(false);
        }
      };
      const removeManagedPlugin = async (receipt) => {
        setManagedRemove({ status: 'busy', packageName: receipt.packageName });
        try {
          const result = await window.deepSeekYukiRyouPlugins.remove({
            packageName: receipt.packageName,
            version: receipt.version,
            generation: receipt.generation,
          });
          setManagedRemove(result?.status === 'prepared'
            ? { status: 'prepared', packageName: receipt.packageName }
            : result?.status === 'cancelled'
              ? { status: 'idle', packageName: null }
              : { status: 'error', packageName: receipt.packageName });
        } catch {
          setManagedRemove({ status: 'error', packageName: receipt.packageName });
        }
      };
      const setManagedPluginEnabled = async (receipt, enabled) => {
        setManagedActivation({ status: 'busy', packageName: receipt.packageName });
        try {
          const result = await window.deepSeekYukiRyouPlugins.setEnabled({
            packageName: receipt.packageName,
            version: receipt.version,
            generation: receipt.generation,
            enabled,
          });
          setManagedActivation(result?.status === 'prepared'
            ? { status: 'prepared', packageName: receipt.packageName }
            : result?.status === 'cancelled'
              ? { status: 'idle', packageName: null }
              : { status: 'error', packageName: receipt.packageName });
        } catch {
          setManagedActivation({ status: 'error', packageName: receipt.packageName });
        }
      };
      const rollbackManagedPlugin = async (receipt) => {
        if (receipt.rollbackTarget === null) return;
        setManagedRollback({ status: 'busy', packageName: receipt.packageName });
        try {
          const result = await window.deepSeekYukiRyouPlugins.rollback({
            packageName: receipt.packageName,
            version: receipt.version,
            generation: receipt.generation,
          });
          setManagedRollback(result?.status === 'prepared'
            ? { status: 'prepared', packageName: receipt.packageName }
            : result?.status === 'cancelled'
              ? { status: 'idle', packageName: null }
              : { status: 'error', packageName: receipt.packageName });
        } catch {
          setManagedRollback({ status: 'error', packageName: receipt.packageName });
        }
      };
      const controlExternalPlugin = async (entry, action) => {
        const capability = entry.externalControl;
        if (capability === undefined) return;
        const updateState = action === 'uninstall' ? setManagedRemove : setManagedActivation;
        updateState({ status: 'busy', packageName: capability.packageName });
        try {
          const result = await window.deepSeekYukiRyouPlugins.controlExternal({
            packageName: capability.packageName,
            version: capability.version,
            entryId: capability.entryIds[0],
            action,
          });
          updateState(result?.status === 'prepared'
            ? { status: 'prepared', packageName: capability.packageName }
            : result?.status === 'cancelled'
              ? { status: 'idle', packageName: null }
              : { status: 'error', packageName: capability.packageName });
        } catch {
          updateState({ status: 'error', packageName: capability.packageName });
        }
      };
      const addSource = async (event) => {
        event.preventDefault();
        if (await applySourceMutation({ kind: 'add', displayName: sourceName, url: sourceUrl })) {
          setSourceName('');
          setSourceUrl('');
        }
      };
      const startInspection = async () => {
        if (selected?.installability?.state !== 'candidate') return;
        setInspection({ status: 'loading', value: null });
        try {
          const value = await inspectInstall({
            sourceRecordId: selected.provenance.sourceId,
            itemId: selected.id,
            versionPreference,
          });
          setInspection({ status: 'ready', value });
        } catch {
          setInspection({ status: 'error', value: null });
        }
      };
      const prepareManagedInstall = async () => {
        if (selected?.installability?.state !== 'candidate' ||
          typeof window.deepSeekYukiRyouPlugins?.preview !== 'function') return;
        setManagedInstall({ status: 'preparing', value: null });
        try {
          const value = await window.deepSeekYukiRyouPlugins.preview({
            sourceRecordId: selected.provenance.sourceId,
            itemId: selected.id,
            versionPreference,
            ...(selectedInstalled?.externalControl === undefined ? {} : {
              externalIdentity: {
                packageName: selectedInstalled.externalControl.packageName,
                version: selectedInstalled.externalControl.version,
                entryId: selectedInstalled.externalControl.entryIds[0],
              },
            }),
          });
          setManagedInstall(value.status === 'ready'
            ? { status: 'ready', value }
            : { status: 'error', value: null });
        } catch {
          setManagedInstall({ status: 'error', value: null });
        }
      };
      const executeManagedInstall = async () => {
        const preview = managedInstall.value;
        if (preview?.status !== 'ready' || typeof window.deepSeekYukiRyouPlugins?.execute !== 'function') return;
        setManagedInstall({ status: 'executing', value: preview });
        try {
          const result = await window.deepSeekYukiRyouPlugins.execute({ previewId: preview.previewId });
          if (result.status === 'cancelled') {
            setManagedInstall({ status: 'cancelled', value: preview });
          } else if (result.status === 'prepared') {
            setManagedInstall({ status: 'prepared', value: preview });
          } else {
            setManagedInstall({ status: 'error', value: null });
          }
        } catch {
          setManagedInstall({ status: 'error', value: null });
        }
      };
      const renderManagedInstall = () => {
        const bridgeAvailable = typeof window.deepSeekYukiRyouPlugins?.preview === 'function' &&
          typeof window.deepSeekYukiRyouPlugins?.execute === 'function';
        if (!bridgeAvailable) return null;
        if (managedInstall.status === 'idle') {
          if (selectedInstalled?.externalControl !== undefined) {
            return React.createElement('button', {
              type: 'button', className: 'dsh-market-button dsh-market-primary', onClick: prepareManagedInstall,
            }, updateCheck.status === 'ready' && updateCheck.value.updateAvailable
              ? format(t, 'updateFound', { version: updateCheck.value.latestVersion }) : t('prepareAdopt'));
          }
          const receipt = inventory.entries.find((entry) => entry.receipt?.packageName === selected?.package?.name)?.receipt;
          const candidateVersion = inspection.value?.identity?.version ?? selected?.package?.version;
          const action = receipt === undefined ? 'prepareInstall'
            : candidateVersion === receipt.version ? 'upToDate' : 'prepareUpdate';
          if (action === 'upToDate') {
            return React.createElement('p', { className: 'dsh-market-install-status', role: 'status' }, t('upToDate'));
          }
          return React.createElement('button', {
            type: 'button', className: 'dsh-market-button dsh-market-primary', onClick: prepareManagedInstall,
          }, t(action));
        }
        if (managedInstall.status === 'preparing') {
          return React.createElement('p', { className: 'dsh-market-install-status', role: 'status' }, t('preparingInstall'));
        }
        if (managedInstall.status === 'error') {
          return React.createElement('div', { className: 'dsh-market-install-actions' },
            React.createElement('p', { className: 'dsh-market-install-status', role: 'alert' }, t('installUnavailable')),
            React.createElement('button', { type: 'button', className: 'dsh-market-button', onClick: prepareManagedInstall }, t('retry')),
          );
        }
        const preview = managedInstall.value;
        if (preview === null) return null;
        if (managedInstall.status === 'prepared') {
          return React.createElement('p', { className: 'dsh-market-install-status', role: 'status' }, t('installPrepared'));
        }
        const minutes = Math.max(1, Math.ceil(preview.expiresInSeconds / 60));
        const operation = preview.operation?.kind ?? 'install';
        const title = operation === 'update' ? 'updatePreviewTitle'
          : operation === 'reinstall' ? 'reinstallPreviewTitle'
            : operation === 'adopt' ? 'adoptPreviewTitle' : 'installPreviewTitle';
        const action = operation === 'update' ? 'updateAndRestart'
          : operation === 'reinstall' ? 'reinstallAndRestart'
            : operation === 'adopt' ? 'adoptAndRestart' : 'installAndRestart';
        return React.createElement('div', { className: 'dsh-market-install-preview' },
          React.createElement('h5', null, t(title)),
          React.createElement('div', { className: 'dsh-market-inspection-meta' },
            operation !== 'install' && React.createElement(React.Fragment, null,
              React.createElement('strong', null, t('currentVersion')), React.createElement('span', null, preview.operation.currentVersion),
            ),
            React.createElement('strong', null, t('inspectionPackage')), React.createElement('span', null, `${preview.summary.packageName}@${preview.summary.version}`),
            React.createElement('strong', null, t('installSize')), React.createElement('span', null, `${formatBytes(preview.summary.artifact.verifiedCompressedBytes)} / ${formatBytes(preview.summary.artifact.verifiedUnpackedBytes)}`),
            React.createElement('strong', null, t('installFiles')), React.createElement('span', null, String(preview.summary.artifact.verifiedFileCount)),
            React.createElement('strong', null, t('installGraph')), React.createElement('span', null, `${preview.summary.dependencies.nodes} nodes · ${preview.summary.dependencies.edges} edges`),
            React.createElement('strong', null, t('installValidity')), React.createElement('span', null, format(t, 'installValidityValue', { minutes })),
          ),
          React.createElement('p', { className: 'dsh-market-install-warning' }, t('installPermissionWarning')),
          managedInstall.status === 'cancelled' && React.createElement('p', { className: 'dsh-market-install-status', role: 'status' }, t('installCancelled')),
          React.createElement('button', {
            type: 'button', className: 'dsh-market-button dsh-market-primary',
            disabled: managedInstall.status === 'executing', onClick: executeManagedInstall,
          }, managedInstall.status === 'executing' ? t('preparingInstall') : t(action)),
        );
      };
      const developmentFixtureSelected = selected?.provenance?.sourceId === 'desktop-development-fixture';
      const curatedSelected = selected?.provenance?.sourceId === 'yukiryou-curated';
      const sourceDisplayName = (source) => source?.id === 'yukiryou-curated'
        ? t('sourceYukiRyouName')
        : source?.displayName ?? '';
      const checkLabel = (key) => key === 'tarball-origin' && developmentFixtureSelected
        ? t('checkBundledFixtureOrigin')
        : t(`check${key.split('-').map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join('')}`);
      const discoverContent = catalog.status === 'loading' && catalog.snapshot === null
        ? React.createElement('div', { className: 'dsh-market-message', role: 'status' }, t('loading'))
        : catalog.status === 'error' || catalog.status === 'rate-limited'
          ? React.createElement('div', { className: 'dsh-market-message', role: 'alert' },
              t(catalog.status === 'rate-limited' ? 'rateLimited' : 'unavailable'),
              React.createElement('button', { type: 'button', className: 'dsh-market-button', onClick: () => load(true) }, t('retry')),
            )
          : React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'dsh-market-toolbar' },
                React.createElement('input', { className: 'dsh-market-search', type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'), onChange: (event) => { setQuery(event.currentTarget.value); setPage(1); } }),
                React.createElement('select', { className: 'dsh-market-select', value: category, 'aria-label': t('allCategories'), onChange: (event) => { setCategory(event.currentTarget.value); setPage(1); } },
                  React.createElement('option', { value: 'all' }, t('allCategories')),
                  ...categories.map((item) => React.createElement('option', { key: item, value: item }, item)),
                ),
                React.createElement('button', { type: 'button', className: 'dsh-market-button', onClick: () => load(true) }, t('refresh')),
              ),
              visible.length === 0
                ? React.createElement('div', { className: 'dsh-market-message' }, t('empty'))
                : React.createElement('div', { className: 'dsh-market-grid' }, ...visible.map((item) =>
                    React.createElement('article', { className: 'dsh-market-card', key: item.id },
                      React.createElement('div', { className: 'dsh-market-card-head' },
                        React.createElement(MarketIcon, { item }),
                        React.createElement('div', { className: 'dsh-market-card-title' },
                          React.createElement('div', { className: 'dsh-market-name', title: item.displayName }, item.displayName),
                          React.createElement('div', { className: 'dsh-market-publisher', title: item.publisher?.name ?? '' }, item.publisher?.name ?? ''),
                        ),
                      ),
                      React.createElement('p', { className: 'dsh-market-summary' }, item.summary || t('noSummary')),
                      React.createElement('div', { className: 'dsh-market-tags' }, ...item.categories.slice(0, 3).map((itemCategory) => React.createElement('span', { className: 'dsh-market-tag', key: itemCategory, title: itemCategory }, itemCategory))),
                      React.createElement('div', { className: 'dsh-market-footer' },
                        React.createElement('span', { className: 'dsh-market-source', title: sourceDisplayName(catalog.snapshot.source) }, sourceDisplayName(catalog.snapshot.source)),
                        React.createElement('div', { className: 'dsh-market-card-actions' },
                          React.createElement('button', { type: 'button', className: 'dsh-market-detail', onClick: () => openCatalogDetails(item) }, t('details')),
                          React.createElement('a', { className: 'dsh-market-link', href: item.repository, target: '_blank', rel: 'noreferrer' }, `${t('repository')} ↗`),
                        ),
                      ),
                    ),
                  )),
              filtered.length > pageSize && React.createElement('div', { className: 'dsh-market-pagination' },
                React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: currentPage <= 1, onClick: () => setPage(currentPage - 1) }, t('previous')),
                React.createElement('span', null, format(t, 'page', { current: currentPage, total: totalPages })),
                React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: currentPage >= totalPages, onClick: () => setPage(currentPage + 1) }, t('next')),
              ),
            );

      const content = view === 'discover'
        ? discoverContent
        : view === 'installable'
          ? React.createElement(React.Fragment, null,
              searchControl,
              installable.length === 0
                ? React.createElement('div', { className: 'dsh-market-panel' },
                    React.createElement('h3', null, `${t('installable')} · ${format(t, 'items', { count: 0 })}`),
                    React.createElement('p', null, t('installableEmpty')),
                    React.createElement('p', { className: 'dsh-market-source-notice' }, t('installableHelp')),
                  )
                : filteredInstallable.length === 0
                  ? React.createElement('div', { className: 'dsh-market-message' }, t('empty'))
                  : React.createElement(React.Fragment, null,
                React.createElement('p', { className: 'dsh-market-source-notice' }, t('installableHelp')),
                React.createElement('div', { className: 'dsh-market-installed-list' }, ...visibleInstallable.map((item) =>
                  React.createElement('button', { type: 'button', className: 'dsh-market-installed-row', key: item.id, onClick: () => openCatalogDetails(item) },
                    React.createElement('span', { className: 'dsh-market-installed-name', title: item.displayName }, item.displayName),
                    React.createElement('span', { className: 'dsh-market-installed-meta' }, item.package?.name ?? ''),
                    React.createElement('span', { className: 'dsh-market-installed-meta' }, item.package?.version
                      ? format(t, 'catalogVersionInline', { version: item.package.version })
                      : ''),
                  ),
                )),
                filteredInstallable.length > pageSize && React.createElement('div', { className: 'dsh-market-pagination' },
                  React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: installablePage <= 1, onClick: () => setPage(installablePage - 1) }, t('previous')),
                  React.createElement('span', null, format(t, 'page', { current: installablePage, total: installablePages })),
                  React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: installablePage >= installablePages, onClick: () => setPage(installablePage + 1) }, t('next')),
                ),
              ),
            )
          : view === 'installed'
            ? inventory.status === 'loading' && inventory.entries.length === 0
              ? React.createElement('div', { className: 'dsh-market-message', role: 'status' }, t('installedLoading'))
              : inventory.status === 'error'
                ? React.createElement('div', { className: 'dsh-market-message', role: 'alert' }, t('installedError'))
                : scopedInstalled.length === 0
                  ? React.createElement(React.Fragment, null,
                    installedToolbar,
                    React.createElement('div', { className: 'dsh-market-message' }, t(installedScope === 'user' ? 'installedUserEmpty' : 'installedEmpty')),
                  )
                  : React.createElement(React.Fragment, null,
                    installedToolbar,
                    filteredInstalled.length === 0
                      ? React.createElement('div', { className: 'dsh-market-message' }, t('empty'))
                      : React.createElement('div', { className: 'dsh-market-installed-list' }, ...visibleInstalled.map((entry) => {
                      const detail = entry.receipt === undefined
                        ? entry.externalControl?.version ?? null
                        : `${entry.receipt.version} · ${format(t, 'installedAt', { time: formatDateTime(entry.receipt.installedAt) })}`;
                      return React.createElement('div', { className: 'dsh-market-installed-row', key: entry.entryId },
                        React.createElement('span', { className: 'dsh-market-installed-identity' },
                          React.createElement('span', { className: 'dsh-market-installed-name', title: entry.moduleName }, entry.moduleName),
                          detail && React.createElement('span', { className: 'dsh-market-installed-detail' }, detail),
                          entry.receipt?.lastBlockedAttempt && React.createElement('span', { className: 'dsh-market-installed-detail' }, format(t, 'blockedAttempt', { version: entry.receipt.lastBlockedAttempt.version })),
                          entry.receipt?.rollbackTarget && React.createElement('span', { className: 'dsh-market-installed-detail' }, format(t, 'rollbackTarget', { version: entry.receipt.rollbackTarget.version })),
                          managedRemove.status === 'error' && managedRemove.packageName === (entry.receipt?.packageName ?? entry.externalControl?.packageName) && React.createElement('span', { className: 'dsh-market-installed-detail', role: 'alert' }, t('uninstallUnavailable')),
                          managedActivation.status === 'error' && managedActivation.packageName === (entry.receipt?.packageName ?? entry.externalControl?.packageName) && React.createElement('span', { className: 'dsh-market-installed-detail', role: 'alert' }, t('enabledUnavailable')),
                          managedRollback.status === 'error' && managedRollback.packageName === entry.receipt?.packageName && React.createElement('span', { className: 'dsh-market-installed-detail', role: 'alert' }, t('rollbackUnavailable')),
                        ),
                        React.createElement('span', { className: 'dsh-market-installed-status' },
                          React.createElement('span', null, t(entry.ownership)),
                          entry.recoverySkipped && React.createElement('span', { role: 'status' }, t('recoverySkipped')),
                          React.createElement('span', null, `${t(entry.runtimeState)} · ${t(entry.receipt ? 'managedState' : entry.externalControl ? 'externalState' : 'readonlyState')}`),
                        ),
                        React.createElement('span', { className: 'dsh-market-installed-actions' },
                          React.createElement('button', { type: 'button', className: 'dsh-market-button', onClick: () => openInstalledDetails(entry) }, t(entry.receipt || entry.externalControl ? 'checkUpdates' : 'details')),
                          entry.receipt && React.createElement(React.Fragment, null,
                          entry.receipt.rollbackTarget && React.createElement('button', {
                            type: 'button',
                            className: 'dsh-market-button',
                            disabled: managedRemove.status === 'busy' || managedRemove.status === 'prepared' || managedActivation.status === 'busy' || managedActivation.status === 'prepared' || managedRollback.status === 'busy' || managedRollback.status === 'prepared',
                            onClick: () => rollbackManagedPlugin(entry.receipt),
                          }, managedRollback.packageName === entry.receipt.packageName &&
                            (managedRollback.status === 'busy' || managedRollback.status === 'prepared')
                            ? t('rollingBack') : t('rollbackPlugin')),
                          React.createElement('button', {
                            type: 'button',
                            className: 'dsh-market-button',
                            disabled: managedRemove.status === 'busy' || managedRemove.status === 'prepared' || managedActivation.status === 'busy' || managedActivation.status === 'prepared' || managedRollback.status === 'busy' || managedRollback.status === 'prepared',
                            onClick: () => setManagedPluginEnabled(entry.receipt, !entry.receipt.enabled),
                          }, managedActivation.packageName === entry.receipt.packageName &&
                            (managedActivation.status === 'busy' || managedActivation.status === 'prepared')
                            ? t('changingPlugin') : t(entry.receipt.enabled ? 'disablePlugin' : 'enablePlugin')),
                          React.createElement('button', {
                            type: 'button',
                            className: 'dsh-market-button',
                            disabled: managedRemove.status === 'busy' || managedRemove.status === 'prepared' || managedActivation.status === 'busy' || managedActivation.status === 'prepared' || managedRollback.status === 'busy' || managedRollback.status === 'prepared',
                            onClick: () => removeManagedPlugin(entry.receipt),
                          }, managedRemove.packageName === entry.receipt.packageName &&
                            (managedRemove.status === 'busy' || managedRemove.status === 'prepared')
                            ? t('uninstalling') : t('uninstall')),
                          ),
                          entry.externalControl && React.createElement(React.Fragment, null,
                            React.createElement('button', {
                              type: 'button', className: 'dsh-market-button',
                              disabled: managedRemove.status === 'busy' || managedRemove.status === 'prepared' || managedActivation.status === 'busy' || managedActivation.status === 'prepared',
                              onClick: () => controlExternalPlugin(entry, entry.externalControl.enabled ? 'disable' : 'enable'),
                            }, managedActivation.packageName === entry.externalControl.packageName &&
                              (managedActivation.status === 'busy' || managedActivation.status === 'prepared')
                              ? t('changingPlugin') : t(entry.externalControl.enabled ? 'disablePlugin' : 'enablePlugin')),
                            React.createElement('button', {
                              type: 'button', className: 'dsh-market-button',
                              disabled: managedRemove.status === 'busy' || managedRemove.status === 'prepared' || managedActivation.status === 'busy' || managedActivation.status === 'prepared',
                              onClick: () => controlExternalPlugin(entry, 'uninstall'),
                            }, managedRemove.packageName === entry.externalControl.packageName &&
                              (managedRemove.status === 'busy' || managedRemove.status === 'prepared')
                              ? t('uninstalling') : t('uninstall')),
                          ),
                        ),
                      );
                      })),
                    filteredInstalled.length > pageSize && React.createElement('div', { className: 'dsh-market-pagination' },
                      React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: installedPage <= 1, onClick: () => setPage(installedPage - 1) }, t('previous')),
                      React.createElement('span', null, format(t, 'page', { current: installedPage, total: installedPages })),
                      React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: installedPage >= installedPages, onClick: () => setPage(installedPage + 1) }, t('next')),
                    ),
                  )
            : sourceRecords.status === 'loading'
              ? React.createElement('div', { className: 'dsh-market-message', role: 'status' }, t('loading'))
              : sourceRecords.status === 'error'
                ? React.createElement('div', { className: 'dsh-market-message', role: 'alert' }, t('unavailable'))
                : React.createElement(React.Fragment, null,
                  React.createElement('form', { className: 'dsh-market-source-form', onSubmit: addSource },
                    React.createElement('h3', null, t('sourceAddTitle')),
                    React.createElement('input', { className: 'dsh-market-search', value: sourceName, maxLength: 80, required: true, placeholder: t('sourceName'), 'aria-label': t('sourceName'), onChange: (event) => setSourceName(event.currentTarget.value) }),
                    React.createElement('input', { className: 'dsh-market-search', type: 'url', value: sourceUrl, maxLength: 2048, required: true, pattern: 'https://.*', placeholder: t('sourceUrl'), 'aria-label': t('sourceUrl'), onChange: (event) => setSourceUrl(event.currentTarget.value) }),
                    React.createElement('button', { type: 'submit', className: 'dsh-market-button', disabled: sourceBusy }, t('sourceAdd')),
                    sourceError && React.createElement('p', { className: 'dsh-market-source-error', role: 'alert' }, t('sourceMutationError')),
                  ),
                  React.createElement('div', { className: 'dsh-market-source-list' }, ...sourceRecords.entries.map((source, index) => {
                    const selectedSource = source.id === sourceId;
                    const custom = source.builtIn === false;
                    return React.createElement('div', { className: 'dsh-market-source-card', 'data-selected': selectedSource, 'data-enabled': source.enabled, key: source.id },
                      React.createElement('div', null,
                        React.createElement('h3', null, sourceDisplayName(source)),
                        React.createElement('p', null, t(source.id === 'dshfind'
                          ? 'sourceDshfindDescription'
                          : source.id === 'yukiryou-curated' ? 'sourceYukiRyouDescription'
                          : source.id === 'dsh-1024store' ? 'source1024Description'
                            : source.id === 'github-topic-dsh-plugin' ? 'sourceGithubDescription'
                              : source.developmentOnly === true ? 'sourceDevelopmentDescription' : 'sourceCustomDescription')),
                        React.createElement('p', null, `${t('sourceProvider')}: ${source.providerId}`),
                        custom && React.createElement('p', { className: 'dsh-market-source-url' }, source.url),
                      ),
                      React.createElement('div', { className: 'dsh-market-source-actions' },
                        selectedSource
                          ? React.createElement('span', { className: 'dsh-market-source-badge' }, custom ? t('sourceActive') : `${t('sourceActive')} · ${t('sourceBuiltIn')}`)
                          : source.enabled && React.createElement('button', { type: 'button', className: 'dsh-market-button', onClick: () => selectSource(source.id) }, t('sourceSelect')),
                        !source.enabled && React.createElement('span', { className: 'dsh-market-source-badge' }, t('sourceDisabled')),
                        custom && React.createElement(React.Fragment, null,
                          React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: sourceBusy || index === sourceRecords.entries.findIndex((entry) => entry.builtIn === false), onClick: () => applySourceMutation({ kind: 'move', sourceId: source.id, direction: 'up' }) }, t('sourceUp')),
                          React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: sourceBusy || index === sourceRecords.entries.length - 1, onClick: () => applySourceMutation({ kind: 'move', sourceId: source.id, direction: 'down' }) }, t('sourceDown')),
                          React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: sourceBusy, onClick: () => applySourceMutation({ kind: 'set-enabled', sourceId: source.id, enabled: !source.enabled }) }, t(source.enabled ? 'sourceDisable' : 'sourceEnable')),
                          React.createElement('button', { type: 'button', className: 'dsh-market-button', disabled: sourceBusy, onClick: () => applySourceMutation({ kind: 'remove', sourceId: source.id }) }, t('sourceRemove')),
                        ),
                      ),
                    );
                  })),
                  React.createElement('p', { className: 'dsh-market-source-notice' }, t('sourceNotice')),
                );

      return React.createElement('section', { className: 'dsh-market-page' },
        React.createElement('h2', null, t('title')),
        React.createElement('p', { className: 'dsh-market-description' }, t('description')),
        React.createElement('div', { className: 'dsh-market-notice' }, t('readonly')),
        catalog.snapshot && React.createElement('div', { className: 'dsh-market-index-status', 'data-cache': catalog.snapshot.cache?.status ?? 'network' },
          React.createElement('strong', null, catalog.snapshot.source.complete ? t('sourceComplete') : t('sourceTruncated')),
          React.createElement('span', null, format(t, 'sourceIndexed', { indexed: catalog.snapshot.source.indexedTotal, total: catalog.snapshot.source.providerTotal })),
          catalog.status === 'loading' && React.createElement('span', { role: 'status' }, t('catalogRefreshing')),
          React.createElement('span', null, catalog.snapshot.cache?.status === 'persistent'
            ? format(t, 'cachePersistent', { time: formatDateTime(catalog.snapshot.cache.storedAt) })
            : catalog.snapshot.cache?.status === 'stale'
              ? format(t, 'cacheStale', { time: formatDateTime(catalog.snapshot.cache.storedAt) })
              : catalog.snapshot.cache?.status === 'development'
                ? t('cacheDevelopment')
                : t('cacheNetwork')),
          React.createElement('span', null, t(catalog.snapshot.source.complete ? 'completeIndexHelp' : 'truncatedIndexHelp')),
        ),
        React.createElement('div', { className: 'dsh-market-views', role: 'tablist', 'aria-label': t('title') }, ...views.map(([id, label, count]) =>
          React.createElement('button', { key: id, type: 'button', className: 'dsh-market-view', role: 'tab', 'aria-selected': view === id, onClick: () => selectView(id) },
            t(label), React.createElement('span', { className: 'dsh-market-count' }, count),
          ),
        )),
        content,
        selected && React.createElement('div', { className: 'dsh-market-modal-backdrop', role: 'presentation', onClick: (event) => { if (event.currentTarget === event.target) closeDetails(); } },
          React.createElement('div', { className: 'dsh-market-modal', role: 'dialog', 'aria-modal': true, 'aria-label': selected.displayName },
            React.createElement('div', { className: 'dsh-market-modal-head' },
              React.createElement(MarketIcon, { item: selected, large: true }),
              React.createElement('h3', null, selected.displayName),
              React.createElement('button', { type: 'button', className: 'dsh-market-modal-close', 'aria-label': t('close'), onClick: closeDetails }, '×'),
            ),
            React.createElement('p', { className: 'dsh-market-modal-summary' }, selected.summary || t(selectedInstalled ? 'installedMetadataUnavailable' : 'noSummary')),
            React.createElement('dl', { className: 'dsh-market-detail-grid' },
              React.createElement('dt', null, t('publisher')), React.createElement('dd', null, selected.publisher?.name ?? '—'),
              React.createElement('dt', null, t('source')), React.createElement('dd', null, sourceDisplayName(selectedSource)),
              React.createElement('dt', null, t('observed')), React.createElement('dd', null, formatDateTime(selected.provenance.observedAt)),
              React.createElement('dt', null, t('categories')), React.createElement('dd', null, selected.categories?.join(' · ') || '—'),
              selectedInstalled && React.createElement(React.Fragment, null,
                React.createElement('dt', null, t('installedVersion')),
                React.createElement('dd', null, selectedInstalled.receipt?.version ?? selectedInstalled.externalControl?.version ?? '—'),
                React.createElement('dt', null, t('installedOwnership')),
                React.createElement('dd', null, t(selectedInstalled.ownership)),
                React.createElement('dt', null, t('installedState')),
                React.createElement('dd', null, t(selectedInstalled.runtimeState)),
                updateCheck.status === 'ready' && React.createElement(React.Fragment, null,
                  React.createElement('dt', null, t('updateLatest')),
                  React.createElement('dd', null, updateCheck.value.latestVersion),
                ),
              ),
              selected.developerVerification && React.createElement(React.Fragment, null,
                React.createElement('dt', null, t('developerVerification')),
                React.createElement('dd', null, selected.developerVerification.notes || t('developerVerification')),
                React.createElement('dt', null, t('verifiedPlatforms')),
                React.createElement('dd', null, selected.developerVerification.platforms.join(' · ')),
                React.createElement('dt', null, t('verifiedHarness')),
                React.createElement('dd', null, selected.developerVerification.harnessVersion),
                React.createElement('dt', null, t('verifiedAt')),
                React.createElement('dd', null, formatDateTime(selected.developerVerification.testedAt)),
              ),
            ),
            (selectedInstalled?.receipt || selectedInstalled?.externalControl) && React.createElement('div', { className: 'dsh-market-inspection' },
              React.createElement('p', {
                className: 'dsh-market-inspection-summary',
                role: updateCheck.status === 'error' ? 'alert' : 'status',
              }, updateCheck.status === 'loading'
                ? t('updateChecking')
                : updateCheck.status === 'error'
                  ? t('updateCheckUnavailable')
                  : updateCheck.status === 'ready'
                    ? (updateCheck.value.updateAvailable
                      ? format(t, 'updateFound', { version: updateCheck.value.latestVersion })
                      : t('updateCurrent'))
                    : ''),
              selectedInstalled?.externalControl === undefined && updateCheck.status === 'ready' && updateCheck.value.updateAvailable &&
                React.createElement('p', { className: 'dsh-market-source-notice' }, t('updateCatalogRequired')),
            ),
            selectedInstalled && !selectedInstalled.receipt && (!selectedInstalled.externalControl || selectedInstalled.externalControl.updateUnavailableReason) && React.createElement('p', { className: 'dsh-market-source-notice' }, t('externalUpdateUnsupported')),
            selectedInstalled?.externalControl && !selectedInstalled.externalControl.updateUnavailableReason && React.createElement('p', { className: 'dsh-market-source-notice' }, t('externalUpdateAdoption')),
            React.createElement('div', { className: 'dsh-market-trust' }, React.createElement('strong', null, t('trustTitle')), t(developmentFixtureSelected ? 'developmentTrust' : curatedSelected ? 'curatedTrust' : 'trust')),
            selected.installability?.state === 'candidate' && (!selectedInstalled || selectedInstalled.receipt || selectedInstalled.externalControl) && React.createElement('div', { className: 'dsh-market-inspection' },
              React.createElement('h4', null, t('inspectionTitle')),
              React.createElement('fieldset', { className: 'dsh-market-version-choice', disabled: inspection.status === 'loading' || managedInstall.status !== 'idle' },
                React.createElement('legend', null, t('versionChoiceTitle')),
                React.createElement('label', { className: 'dsh-market-version-option' },
                  React.createElement('input', {
                    type: 'radio', name: 'dsh-market-version-preference', value: 'catalog',
                    checked: versionPreference === 'catalog',
                    onChange: () => { setVersionPreference('catalog'); setInspection({ status: 'idle', value: null }); setManagedInstall({ status: 'idle', value: null }); },
                  }),
                  React.createElement('strong', null, t('catalogVersionChoice')),
                  React.createElement('span', null, format(t, 'catalogVersionChoiceHelp', { version: selected.package.version })),
                ),
                React.createElement('label', { className: 'dsh-market-version-option' },
                  React.createElement('input', {
                    type: 'radio', name: 'dsh-market-version-preference', value: 'latest',
                    checked: versionPreference === 'latest',
                    onChange: () => { setVersionPreference('latest'); setInspection({ status: 'idle', value: null }); setManagedInstall({ status: 'idle', value: null }); },
                  }),
                  React.createElement('strong', null, t('latestVersionChoice')),
                  React.createElement('span', null, t('latestVersionChoiceHelp')),
                ),
              ),
              selectedInstalled?.externalControl !== undefined
                ? renderManagedInstall()
                : inspection.status === 'idle'
                ? React.createElement('button', { type: 'button', className: 'dsh-market-button dsh-market-primary', onClick: startInspection }, t(selectedInstalled ? 'checkUpdates' : 'inspect'))
                : inspection.status === 'loading'
                  ? React.createElement('p', { className: 'dsh-market-inspection-summary', role: 'status' }, t(developmentFixtureSelected ? 'inspectionLoadingDevelopment' : 'inspectionLoading'))
                  : inspection.status === 'error'
                    ? React.createElement(React.Fragment, null,
                        React.createElement('p', { className: 'dsh-market-inspection-summary', role: 'alert' }, t('inspectionUnavailable')),
                        React.createElement('button', { type: 'button', className: 'dsh-market-button', onClick: startInspection }, t('retry')),
                      )
                    : React.createElement(React.Fragment, null,
                        React.createElement('p', { className: 'dsh-market-inspection-summary' }, t(inspection.value.status === 'artifact-verified' ? 'inspectionVerified' : 'inspectionBlocked')),
                         React.createElement('div', { className: 'dsh-market-inspection-meta' },
                           inspection.value.identity.catalogVersion !== inspection.value.identity.version && React.createElement(React.Fragment, null,
                             React.createElement('strong', null, t('catalogVersion')), React.createElement('span', null, inspection.value.identity.catalogVersion),
                             React.createElement('strong', null, t('latestVersion')), React.createElement('span', null, inspection.value.identity.version),
                           ),
                           React.createElement('strong', null, t('inspectionPackage')), React.createElement('span', null, `${inspection.value.identity.packageName}@${inspection.value.identity.version}`),
                          React.createElement('strong', null, t('inspectionPlatform')), React.createElement('span', null, `${inspection.value.environment.platform}-${inspection.value.environment.architecture}`),
                          React.createElement('strong', null, t('inspectionDependencies')), React.createElement('span', null, `${inspection.value.dependencySummary.direct} / ${inspection.value.dependencySummary.peers}`),
                          inspection.value.dependencySummary.graphStatus === 'frozen' && React.createElement(React.Fragment, null,
                            React.createElement('strong', null, t('inspectionGraph')),
                            React.createElement('span', null, `${inspection.value.dependencySummary.nodes} nodes · ${inspection.value.dependencySummary.edges} edges · depth ${inspection.value.dependencySummary.maxDepth}`),
                          ),
                          inspection.value.dependencySummary.peerSatisfied !== undefined && React.createElement(React.Fragment, null,
                            React.createElement('strong', null, t('inspectionPeers')),
                            React.createElement('span', null, `${inspection.value.dependencySummary.peerSatisfied} passed · ${inspection.value.dependencySummary.peerOptionalMissing} optional · ${inspection.value.dependencySummary.peerBlocked} blocked`),
                          ),
                          inspection.value.artifact.verificationStatus === 'verified' && React.createElement(React.Fragment, null,
                            React.createElement('strong', null, t('inspectionArtifacts')),
                            React.createElement('span', null, `${inspection.value.artifact.verifiedArtifacts} packages · ${formatBytes(inspection.value.artifact.verifiedCompressedBytes)} compressed · ${inspection.value.artifact.verifiedFileCount} files`),
                          ),
                        ),
                        React.createElement('div', { className: 'dsh-market-checks' }, ...inspection.value.checks.map((entry) =>
                          React.createElement('span', { className: 'dsh-market-check', 'data-state': entry.state, key: entry.key }, checkLabel(entry.key)),
                        )),
                        inspection.value.peerIssues?.length > 0 && React.createElement('ul', { className: 'dsh-market-peer-issues' }, ...inspection.value.peerIssues.map((issue) =>
                          React.createElement('li', { className: 'dsh-market-peer-issue', key: `${issue.requiredBy}:${issue.packageName}` },
                            React.createElement('strong', { title: issue.packageName }, `${t(`peer${issue.state[0].toUpperCase()}${issue.state.slice(1)}`)} · ${issue.packageName}`),
                            React.createElement('span', null, `${t('peerRequired')} ${issue.required}${issue.available.length > 0 ? ` · ${t('peerAvailable')} ${issue.available.join(', ')}` : ''}`),
                          ),
                        )),
                        React.createElement('p', { className: 'dsh-market-source-notice' }, t(inspection.value.artifact.verificationStatus === 'verified' ? 'inspectionNoInstall' : 'inspectionNoInstallBlocked')),
                        inspection.value.status === 'artifact-verified' && renderManagedInstall(),
                      ),
            ),
            selected.repository && React.createElement('a', { className: 'dsh-market-link', href: selected.repository, target: '_blank', rel: 'noreferrer' }, `${t('repository')} ↗`),
          ),
        ),
      );
    }

    const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory'];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(namespace, dictionaries), 'dsh-desktop: market dictionaries');
      const t = ctx.locale.bind(namespace);
      const listInstalled = async () => {
        const result = await ctx.remote.pluginInventory.list();
        if (!result.ok) throw new Error('pluginInventory.list failed');
        return result.value;
      };
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: 'desktop-community', order: 30,
        label: () => t('tab'), locale: namespace, inject: () => ({ listInstalled }),
      }, CommunityMarketTab));
    }
    exports.inject = inject;
    exports.apply = apply;
    exports.findInstalledCatalogItem = findInstalledCatalogItem;
    exports.mergeInstalledInventory = mergeInstalledInventory;
    exports.matchesInstalledScope = matchesInstalledScope;
    return module.exports;
  },
});
