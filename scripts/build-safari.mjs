/**
 * Safari build script for Hermes Browser Extension.
 *
 * Copies the extension source to dist/safari/ and generates a WebKit-compatible
 * manifest.json by stripping Chromium-only keys (side_panel, sidebar_action,
 * minimum_chrome_version, _execute_sidebar_action) and permissions Safari does
 * not implement (debugger, offscreen, sidePanel, tabGroups, downloads,
 * declarativeNetRequestWithHostAccess). The result feeds
 * `xcrun safari-web-extension-converter` (npm run convert:safari), which wraps
 * the web extension in a macOS/iOS host app Xcode project.
 *
 * Runtime feature detection lives in lib/browser-runtime.mjs: without
 * sidePanel/sidebarAction the panel host falls back to a full extension tab,
 * and debugger/offscreen-dependent features degrade gracefully.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeContentExtractorRuntime } from './build-content-runtime.mjs';
import { MANIFEST_TARGETS, manifestAssumptionsFor } from './manifest-profiles.mjs';
import { checkSelfContained } from './check-self-contained.mjs';

const root = process.cwd();
const src = path.join(root, 'extension');
const dest = path.join(root, 'dist', 'safari');
const buildInfoFileName = 'build-info.json';
const safariProfile = manifestAssumptionsFor(MANIFEST_TARGETS.SAFARI_WEBKIT);

// Permissions WebKit does not implement beyond the shared profile removals.
const SAFARI_REMOVED_PERMISSIONS = Object.freeze([
  ...safariProfile.removedPermissions,
  'declarativeNetRequestWithHostAccess',
  'downloads',
]);

// Manifest keys WebKit does not implement beyond the shared profile removals.
const SAFARI_REMOVED_MANIFEST_KEYS = Object.freeze([
  ...safariProfile.removedManifestKeys,
  'sidebar_action',
]);

// Command IDs that target panel APIs absent from Safari.
const SAFARI_REMOVED_COMMANDS = Object.freeze(['_execute_sidebar_action']);

await writeContentExtractorRuntime({ rootDir: root });
checkSelfContained(src);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    if (entry.name === buildInfoFileName) continue;
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function buildInfo() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commit = gitOutput(['rev-parse', 'HEAD']);
  const branch = gitOutput(['branch', '--show-current']);
  const status = gitOutput(['status', '--short', '--untracked-files=no']);
  return {
    name: packageJson.name,
    version: packageJson.version,
    commit,
    shortCommit: commit ? commit.slice(0, 7) : '',
    branch,
    dirty: Boolean(status),
    builtAt: new Date().toISOString(),
    repository: packageJson.repository?.url || '',
    target: 'safari',
  };
}

// Read source manifest and transform for Safari (WebKit)
const sourceManifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));

for (const key of SAFARI_REMOVED_MANIFEST_KEYS) delete sourceManifest[key];

if (Array.isArray(sourceManifest.permissions)) {
  sourceManifest.permissions = sourceManifest.permissions.filter(
    (permission) => !SAFARI_REMOVED_PERMISSIONS.includes(permission),
  );
}

if (Array.isArray(sourceManifest.optional_permissions)) {
  sourceManifest.optional_permissions = sourceManifest.optional_permissions
    .filter((permission) => !safariProfile.removedOptionalPermissions.includes(permission));
  if (!sourceManifest.optional_permissions.length) delete sourceManifest.optional_permissions;
}

if (sourceManifest.commands && typeof sourceManifest.commands === 'object') {
  for (const commandId of SAFARI_REMOVED_COMMANDS) delete sourceManifest.commands[commandId];
  if (!Object.keys(sourceManifest.commands).length) delete sourceManifest.commands;
}

// WebKit rejects Chrome-style {resources, matches} objects ("Invalid
// web_accessible_resources manifest entry"); emit the flat string form.
if (Array.isArray(sourceManifest.web_accessible_resources)) {
  const resources = sourceManifest.web_accessible_resources.flatMap((entry) =>
    Array.isArray(entry) ? entry : Array.isArray(entry?.resources) ? entry.resources : [],
  );
  if (resources.length) sourceManifest.web_accessible_resources = resources;
  else delete sourceManifest.web_accessible_resources;
}

// Write build info
const infoJson = `${JSON.stringify(buildInfo(), null, 2)}\n`;

// Clean and copy
fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
for (const fileName of ['wake-listener.html', 'wake-listener.js']) {
  fs.rmSync(path.join(dest, fileName), { force: true });
}

// Write Safari manifest
fs.writeFileSync(path.join(dest, 'manifest.json'), `${JSON.stringify(sourceManifest, null, 2)}\r\n`);

// Write build-info.json
fs.writeFileSync(path.join(dest, buildInfoFileName), infoJson);

console.log(`Built Safari extension: ${dest}`);
console.log('Safari manifest: module service worker, no sidePanel/sidebar_action (full-tab panel fallback), no debugger/offscreen/downloads/DNR permissions');
console.log(`Stamped build metadata: ${buildInfoFileName}`);
console.log('Next: npm run convert:safari (requires macOS + Xcode) to generate the Xcode app project');
