import { app, protocol } from 'electron';

import { AppCoordinator } from './app-coordinator.js';
import {
  isReleaseSmokeTest,
  releaseSmokeMarker,
} from './release-smoke.js';
import { prepareUserDataLocation } from './user-data-location.js';
import { isPetMediaWorkerSmokeTest, runPetMediaWorkerSmoke } from './pet-media-worker-smoke.js';
import { petPlayerSmokePackagePath, runPetPlayerSmoke } from './pet-player-smoke.js';

const moduleDirectory = __dirname;

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-pet',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}]);

async function run(): Promise<void> {
  const petPlayerPackagePath = petPlayerSmokePackagePath(process.argv);
  if (petPlayerPackagePath !== undefined) {
    await app.whenReady();
    try {
      await runPetPlayerSmoke(moduleDirectory, petPlayerPackagePath);
      app.quit();
    } catch (error) {
      process.stderr.write(`Pet player smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    }
    return;
  }
  if (isPetMediaWorkerSmokeTest(process.argv)) {
    await app.whenReady();
    try {
      await runPetMediaWorkerSmoke(moduleDirectory);
      app.quit();
    } catch (error) {
      process.stderr.write(`Pet media worker smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    }
    return;
  }
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

void run();
