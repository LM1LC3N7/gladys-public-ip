// -----------------------------------------------------------------------------
// The Gladys device and its states. Pure.
//
// External ids (forever):
//   internet              the Internet connection of the house
//   internet:<feature>    its features (FEATURE)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';

export const FEATURE = { ONLINE: 'online', IPV4: 'ipv4', IPV6: 'ipv6' };

export const ids = {
  internet: (gladys) => gladys.externalId('internet'),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

// The addresses are text features: Gladys keeps the last one, shows it on
// the device card and hands it back after a restart (the baseline of the
// "public IP changed" trigger).
const text = (deviceId, key, name) =>
  feature(deviceId, key, name, C.TEXT, T.TEXT.TEXT, { max: 0, keep_history: false });

export function buildInternetDevice(gladys) {
  const id = ids.internet(gladys);
  return {
    name: 'Internet',
    external_id: id,
    features: [
      // Same choice as gladys-livebox's "Internet connected": no core category fits better.
      feature(id, FEATURE.ONLINE, 'Internet connected', C.UNKNOWN, T.SENSOR.BINARY),
      text(id, FEATURE.IPV4, 'Public IPv4'),
      text(id, FEATURE.IPV6, 'Public IPv6'),
    ],
  };
}

/** The device the user created, if any. */
export const internetDevice = (gladys) =>
  (gladys.devices ?? []).find((d) => d.external_id === ids.internet(gladys));

/** The last address Gladys kept for a feature (the baseline after a restart). */
export function storedAddress(device, key) {
  const value = (device?.features ?? []).find(
    (f) => f.external_id === ids.feature(device.external_id, key),
  )?.last_value_string;
  return typeof value === 'string' ? value : undefined;
}

/** States of the device; `online` null (not decided yet) publishes nothing. */
export function internetStates(deviceId, { online, ipv4, ipv6 }) {
  const states = [];
  if (online !== null && online !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(deviceId, FEATURE.ONLINE),
      state: online ? 1 : 0,
    });
  }
  states.push({
    device_feature_external_id: ids.feature(deviceId, FEATURE.IPV4),
    text: ipv4 ?? '—',
  });
  states.push({
    device_feature_external_id: ids.feature(deviceId, FEATURE.IPV6),
    text: ipv6 ?? '—',
  });
  return states;
}
