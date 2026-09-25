import { isExtensionPageTab } from './dashboard-bridge.mjs';

export class CloudAgentTabError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CloudAgentTabError';
    this.code = String(code || 'cloud_agent_tab_error');
    this.detail = detail && typeof detail === 'object' ? detail : {};
  }
}

export function normalizeCloudAgentOrigin(raw = '') {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    throw new CloudAgentTabError('invalid_url', 'The active tab does not have a valid Hermes Cloud URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new CloudAgentTabError('https_required', 'Hermes Cloud agent tabs must use HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new CloudAgentTabError('url_credentials_forbidden', 'The Hermes Cloud URL must not contain a username or password.');
  }
  return parsed.origin;
}

export function validateCloudAgentTab(tab = {}) {
  const tabId = Number(tab?.id);
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new CloudAgentTabError('missing_tab', 'Open your signed-in Hermes Cloud agent in the active tab.');
  }
  if (tab.discarded) {
    throw new CloudAgentTabError('discarded_tab', 'Reload the Hermes Cloud agent tab before connecting.');
  }
  if (tab.pendingUrl || tab.status !== 'complete') {
    throw new CloudAgentTabError('tab_not_ready', 'Wait for the Hermes Cloud agent tab to finish loading, then connect again.');
  }
  return Object.freeze({
    tabId,
    origin: normalizeCloudAgentOrigin(tab.url),
    title: String(tab.title || 'Hermes Cloud agent').trim() || 'Hermes Cloud agent',
    windowId: Number.isInteger(Number(tab.windowId)) ? Number(tab.windowId) : null,
  });
}

function isHttpsTab(tab) {
  try {
    return new URL(String(tab?.url || '')).protocol === 'https:';
  } catch {
    return false;
  }
}

function usableAgentTab(tab) {
  return Boolean(tab
    && tab.id != null
    && !tab.discarded
    && tab.status === 'complete'
    && !tab.pendingUrl
    && isHttpsTab(tab));
}

// On full-tab hosts (Safari, browsers without a side-panel API) the extension
// page itself is the active tab, so the signed-in agent can only sit in a
// background tab. Prefer an agent tab that is active in another window;
// otherwise accept a single unambiguous https candidate. Anything else leaves
// the active-tab requirement in place and errors as before.
async function resolveBackgroundAgentTab({ tabsApi }) {
  const [activeElsewhere, httpsTabs] = await Promise.all([
    tabsApi.query({ active: true }).catch(() => []),
    tabsApi.query({ url: 'https://*/*' }).catch(() => []),
  ]);
  const elsewhere = (Array.isArray(activeElsewhere) ? activeElsewhere : []).filter(usableAgentTab);
  if (elsewhere.length) return elsewhere[0];
  const candidates = (Array.isArray(httpsTabs) ? httpsTabs : []).filter(usableAgentTab);
  if (candidates.length === 1) return candidates[0];
  return null;
}

export async function resolveActiveCloudAgentTab({ tabsApi } = {}) {
  if (!tabsApi?.query) throw new CloudAgentTabError('tabs_api_unavailable', 'The browser tabs API is unavailable.');
  const tabs = await tabsApi.query({ active: true, currentWindow: true });
  const active = Array.isArray(tabs) ? tabs[0] : null;
  if (!isExtensionPageTab(active)) return validateCloudAgentTab(active);
  const background = await resolveBackgroundAgentTab({ tabsApi });
  if (background) return validateCloudAgentTab(background);
  throw new CloudAgentTabError('missing_tab', 'Keep your signed-in Hermes Cloud agent as the only other open https tab, or leave it active in another window, then connect again.');
}

export async function assertCloudAgentTabStillMatches({ tabsApi, tabId, expectedOrigin } = {}) {
  if (!tabsApi?.get) throw new CloudAgentTabError('tabs_api_unavailable', 'The browser tabs API is unavailable.');
  let tab;
  try {
    tab = await tabsApi.get(Number(tabId));
  } catch {
    throw new CloudAgentTabError('tab_closed', 'The Hermes Cloud agent tab was closed while connecting.');
  }
  const current = validateCloudAgentTab(tab);
  if (current.origin !== normalizeCloudAgentOrigin(expectedOrigin)) {
    throw new CloudAgentTabError('tab_origin_changed', 'The active agent tab changed origin while connecting. Nothing was attached.', {
      expectedOrigin,
      actualOrigin: current.origin,
    });
  }
  return current;
}
