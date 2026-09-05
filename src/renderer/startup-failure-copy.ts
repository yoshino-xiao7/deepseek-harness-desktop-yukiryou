const OCCUPIED_RUNTIME_ENDPOINT = 'runtime-endpoint-occupied';

export function startupFailureCopy(code: string): string {
  if (code === 'safe-start-failed') return '安全启动仍然失败，已停止自动重试。当前无法确认是插件问题；请打开日志或导出诊断信息。';
  if (code === OCCUPIED_RUNTIME_ENDPOINT) {
    return [
      '检测到上次的 Harness 端口仍被占用。',
      '请完全退出旧版 DeepSeek YukiRyou；如果端口仍未释放，请重启电脑后再点“重试启动”。',
      '应用不会自动连接或结束未知进程。',
    ].join('');
  }
  return `错误类型：${code}。你可以重试，或导出诊断信息。`;
}
