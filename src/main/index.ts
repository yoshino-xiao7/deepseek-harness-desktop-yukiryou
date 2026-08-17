import { app } from 'electron';

import { AppCoordinator } from './app-coordinator.js';
import { prepareUserDataLocation } from './user-data-location.js';

async function run(): Promise<void> {
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
