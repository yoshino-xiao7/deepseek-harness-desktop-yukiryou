# 外观扩展契约

## 目标

“设置 → 外观”是整个桌面产品的视觉入口，不只控制 Harness 页面。任一后续风格必须同时覆盖：

1. DeepSeek Harness 的组件、页面和状态色。
2. Electron 本地 44px 顶栏的侧栏区域与内容区域。
3. Desktop Companion、Workspace Review，以及规划中的 Pet Library 设置页与 Pet Stage DOM chrome。
4. 浅色、深色和跟随系统下的最终解析结果。

本地顶栏与 Harness 位于两个隔离的 webContents，不能共享 DOM 或直接读取彼此的 CSS。应用使用一条经过校验的外观同步通道连接二者。

## 数据流

```text
Desktop settings extension
        │
        ├─ ctx.theme / Harness token overrides ──► Harness UI
        │
        └─ desktop chrome CSS tokens
                    │
              isolated preload
                    │ normalized rgb + light/dark only
                    ▼
              Electron main
                    │ validated relay
                    ▼
              local toolbar CSS
```

外观桥只同步三项已解析数据：`colorScheme`、`sidebarBackground`、`contentBackground`。不允许传递选择器、CSS 代码、文件路径或任意属性名。

## 风格定义规则

新增风格时，在 `runtime/desktop-settings-plugin` 内完成定义，并通过 Harness 官方主题接口应用 Harness 令牌。禁止从桌面主进程修改 Harness DOM。

顶栏使用两个稳定令牌：

```css
:root {
  --dsh-desktop-chrome-sidebar-background: <color>;
  --dsh-desktop-chrome-content-background: <color>;
}
```

- `sidebar-background` 对应顶栏交通灯与 Harness 侧栏上方区域。
- `content-background` 对应顶栏其余区域。
- 值可以引用 Harness 主题令牌，例如 `var(--dsw-specific-sidebar-fill)`。
- preload 会让浏览器把值解析为 `rgb(...)` / `rgba(...)`，主进程校验后再转发。

一个完整风格至少包含：

```ts
interface DesktopStyleDefinition {
  id: string;
  label: { zh: string; en: string };
  harnessTokens: Record<
    `--${string}`,
    { light: string; dark: string }
  >;
  chrome: {
    sidebarBackground: { light: string; dark: string };
    contentBackground: { light: string; dark: string };
  };
}
```

`harnessTokens` 通过 `ctx.theme.overrideTokens()` 进入 Harness；`chrome` 映射到上述两个稳定 CSS 令牌。选择状态需要由桌面设置扩展持久化，切换风格时一次性更新两部分，不能让调用方分别操作。

## 验证门槛

每个新增风格至少验证：

- 浅色、深色、跟随系统三种模式。
- Harness 侧栏展开、收起动画期间顶栏分界仍对齐。
- 顶栏两段颜色与 Harness 对应区域一致。
- 重启应用后风格选择恢复。
- 未向 Harness 暴露 Electron/Node 能力，IPC 仍只接受归一化颜色。
- 宠物阶段需额外验证 Pet Library 卡片、Pet Stage 边框/气泡、disabled/error/focus 状态和 reduced-motion 在浅色、深色、跟随系统中仍与 Harness token 一致；角色资产本身不被主题滤镜任意改色。

当前端到端测试已经覆盖深色切换后 Harness 与顶栏同步；新增风格时应在同一测试 seam 上补充预设选择与重启持久化断言。
