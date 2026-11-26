'use strict';

const { isDeepStrictEqual } = require('node:util');
const SETTINGS_FILE = '.gigacode/settings.json';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseSettings(text) {
  if (text == null) return null;
  try {
    const value = JSON.parse(text);
    return object(value) ? value : null;
  } catch {
    return null;
  }
}

function hasClientPermissions(value) {
  return object(value) && Object.hasOwn(value, 'permissions');
}

// The client owns the value. Compare only the shared settings around it.
function clientPermissionsOnly(beforeText, afterText) {
  const before = parseSettings(beforeText);
  const after = parseSettings(afterText);
  if (!before || !after || !(hasClientPermissions(before) || hasClientPermissions(after))) return false;
  delete before.permissions;
  delete after.permissions;
  return isDeepStrictEqual(before, after);
}

module.exports = { SETTINGS_FILE, parseSettings, hasClientPermissions, clientPermissionsOnly };
