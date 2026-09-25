import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCloudAgentTabStillMatches,
  normalizeCloudAgentOrigin,
  resolveActiveCloudAgentTab,
  validateCloudAgentTab,
} from '../extension/lib/cloud-agent-tab.mjs';

test('Cloud agent URLs normalize to exact credential-free HTTPS origins', () => {
  assert.equal(normalizeCloudAgentOrigin('https://agent.example.test:9443/chat?x=1#y'), 'https://agent.example.test:9443');
  assert.throws(() => normalizeCloudAgentOrigin('http://agent.example.test'), /HTTPS/);
  assert.throws(() => normalizeCloudAgentOrigin('https://user@agent.example.test'), /username or password/);
});

test('Cloud Preview requires the active complete non-discarded tab', async () => {
  await assert.rejects(() => resolveActiveCloudAgentTab({
    tabsApi: { query: async () => [{ id: 10, status: 'loading', url: 'https://agent.example.test' }] },
  }), /finish loading/);

  assert.deepEqual(validateCloudAgentTab({
    id: 10,
    windowId: 4,
    status: 'complete',
    discarded: false,
    url: 'https://agent.example.test/chat',
    title: 'My Hermes',
  }), {
    tabId: 10,
    windowId: 4,
    origin: 'https://agent.example.test',
    title: 'My Hermes',
  });
});

test('Cloud Preview finds the agent tab in the background on a full-tab host', async () => {
  const extensionTab = { id: 1, url: 'safari-web-extension://abc/sidepanel.html', status: 'complete', active: true };
  const agentTab = {
    id: 10,
    windowId: 4,
    status: 'complete',
    discarded: false,
    url: 'https://agent.example.test/chat',
    title: 'My Hermes',
  };
  const tabsApi = {
    query: async (query) => {
      if (query?.currentWindow) return [extensionTab];
      if (query?.active) return [extensionTab, { ...agentTab, active: true, windowId: 9 }];
      return [extensionTab, agentTab];
    },
  };
  const resolved = await resolveActiveCloudAgentTab({ tabsApi });
  assert.equal(resolved.tabId, 10);
  assert.equal(resolved.origin, 'https://agent.example.test');
});

test('Cloud Preview accepts a single unambiguous https tab on a full-tab host', async () => {
  const extensionTab = { id: 1, url: 'chrome-extension://abc/sidepanel.html', status: 'complete', active: true };
  const agentTab = { id: 10, windowId: 4, status: 'complete', discarded: false, url: 'https://agent.example.test' };
  const tabsApi = {
    query: async (query) => {
      if (query?.currentWindow || query?.active) return [extensionTab];
      return [extensionTab, agentTab];
    },
  };
  const resolved = await resolveActiveCloudAgentTab({ tabsApi });
  assert.equal(resolved.tabId, 10);
});

test('Cloud Preview still errors without a resolvable agent tab on a full-tab host', async () => {
  const extensionTab = { id: 1, url: 'safari-web-extension://abc/sidepanel.html', status: 'complete', active: true };
  const tabsApi = {
    query: async (query) => {
      if (query?.currentWindow || query?.active) return [extensionTab];
      return [
        extensionTab,
        { id: 11, url: 'https://one.example/', status: 'complete' },
        { id: 12, url: 'https://two.example/', status: 'complete' },
      ];
    },
  };
  await assert.rejects(() => resolveActiveCloudAgentTab({ tabsApi }), /only other open https tab|another window/);
});

test('Cloud Preview aborts when the leased tab changes origin', async () => {
  await assert.rejects(() => assertCloudAgentTabStillMatches({
    tabsApi: {
      get: async () => ({
        id: 10,
        windowId: 4,
        status: 'complete',
        discarded: false,
        url: 'https://different.example.test',
      }),
    },
    tabId: 10,
    expectedOrigin: 'https://agent.example.test',
  }), /changed origin/i);
});
