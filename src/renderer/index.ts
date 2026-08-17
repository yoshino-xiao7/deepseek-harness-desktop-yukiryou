const parameters = new URLSearchParams(window.location.search);
const failed = parameters.get('state') === 'failure';
const status = document.querySelector<HTMLElement>('[data-testid="startup-status"]');

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
