import { join } from 'node:path';

export function resolveE2eExecutablePath(): string {
  const override = process.env.DSH_E2E_EXECUTABLE_PATH?.trim();
  if (override !== undefined && override !== '') {
    return override;
  }

  const targetArchitecture = process.env.DSH_E2E_ARCH ?? process.arch;
  return join(
    process.cwd(),
    'out',
    `DeepSeek YukiRyou-darwin-${targetArchitecture}`,
    'DeepSeek YukiRyou.app',
    'Contents',
    'MacOS',
    'DeepSeek YukiRyou',
  );
}
