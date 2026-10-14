// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the PublicIpApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { PublicIpApp } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new PublicIpApp({ gladys });

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(() => app.publishDevices());
gladys.onDeviceCreated((device) => app.deviceCreated(device));
gladys.onDeviceUpdated((device) => app.deviceCreated(device));

// --- Scene actions --------------------------------------------------------------
gladys.onSceneAction(SCENE_ACTIONS.GET_IP, () => app.getPublicIp());
gladys.onSceneAction(SCENE_ACTIONS.UPDATE_DNS, () => app.updateDnsNow());

// --- Dashboard widget ----------------------------------------------------------
gladys.onWidgetGet(WIDGETS.PUBLIC_IP, (request) => app.getWidget(request));
gladys.onWidgetAction(WIDGETS.PUBLIC_IP, (actionKey) => app.widgetAction(actionKey));

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config);
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the public IP integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
