import { app } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';

import { AppCoordinator } from './app-coordinator.js';
import {
  isReleaseSmokeTest,
  releaseSmokeMarker,
} from './release-smoke.js';
import { prepareUserDataLocation } from './user-data-location.js';
import {
  shouldConfigureWindowsApplicationIdentity,
  windowsSquirrelAppUserModelId,
} from './windows-release.js';

async function run(): Promise<void> {
  if (isReleaseSmokeTest(process.argv)) {
    await app.whenReady();
    process.stdout.write(
      `${releaseSmokeMarker} ${JSON.stringify({
        version: app.getVersion(),
        architecture: process.arch,
        packaged: app.isPackaged,
      })}\n`,
    );
    app.quit();
    return;
  }

  const hasExplicitUserData = process.argv.some((argument) =>
    argument.startsWith('--user-data-dir='),
  );
  if (!hasExplicitUserData) {
    const userData = await prepareUserDataLocation(app.getPath('appData'));
    app.setPath('userData', userData);
  }
  const coordinator = new AppCoordinator();
  await coordinator.run();
}

if (shouldConfigureWindowsApplicationIdentity(process.platform)) {
  app.setAppUserModelId(windowsSquirrelAppUserModelId);
}

if (squirrelStartup) {
  app.quit();
} else {
  void run();
}
