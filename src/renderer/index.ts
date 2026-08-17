const parameters = new URLSearchParams(window.location.search);
if (parameters.get('state') === 'failure') {
  const heading = document.querySelector('h1');
  const detail = document.querySelector('p');
  if (heading !== null) {
    heading.textContent = 'DeepSeek Harness 启动失败';
  }
  if (detail !== null) {
    const code = parameters.get('code') ?? 'unknown';
    detail.textContent = `错误类型：${code}。请从应用菜单重启 Harness 或打开日志。`;
  }
  document.querySelector('.progress')?.remove();
  const actions = document.querySelector<HTMLElement>('.failure-actions');
  if (actions !== null) {
    actions.hidden = false;
  }
}
