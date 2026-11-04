const { webFrame } = require('electron');

// Inject stealth evasions into the page's main world (worldId: 0) before any site scripts execute.
// Masks navigator.webdriver, normalizes userAgentData brands & client hints to standard Google Chrome,
// and populates standard window.chrome runtime objects so Google OAuth (accounts.google.com) BotGuard
// and X/Twitter SSO flows treat the window/webview as a standard desktop Chrome browser.
try {
  const chromeFull =
    (typeof process !== 'undefined' && process.versions && process.versions.chrome) ||
    ((typeof navigator !== 'undefined' &&
      navigator.userAgent &&
      (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1]) ||
      '132.0.0.0');
  const chromeMajor = String(chromeFull).split('.')[0] || '132';
  const platformName =
    typeof process !== 'undefined' && process.platform === 'win32'
      ? 'Windows'
      : typeof process !== 'undefined' && process.platform === 'darwin'
        ? 'macOS'
        : 'Linux';

  const MAIN_WORLD_STEALTH_SCRIPT = `
    (() => {
      try {
        if (window.__theysayStealthInstalled) return;
        Object.defineProperty(window, '__theysayStealthInstalled', {
          value: true,
          configurable: false,
          enumerable: false,
          writable: false
        });
      } catch (_) {}

      try {
        // 1. Ensure navigator.webdriver is false (matching non-automated desktop Chrome)
        if (navigator.webdriver !== false) {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true
          });
          if (typeof Navigator !== 'undefined' && Navigator.prototype) {
            Object.defineProperty(Navigator.prototype, 'webdriver', {
              get: () => false,
              configurable: true
            });
          }
        }
      } catch (_) {}

      try {
        // 2. Delegate to native userAgentData while normalizing brands to include Google Chrome
        const origUAData = navigator.userAgentData;
        if (origUAData) {
          const chromeMajor = ${JSON.stringify(chromeMajor)};
          const chromeFull = ${JSON.stringify(chromeFull)};
          const platformName = ${JSON.stringify(platformName)};
          const cleanBrands = [
            { brand: 'Chromium', version: chromeMajor },
            { brand: 'Google Chrome', version: chromeMajor },
            { brand: 'Not:A-Brand', version: '24' }
          ];
          const cleanFullVersionList = [
            { brand: 'Chromium', version: chromeFull },
            { brand: 'Google Chrome', version: chromeFull },
            { brand: 'Not:A-Brand', version: '24.0.0.0' }
          ];

          const nativeGetHighEntropyValues =
            typeof origUAData.getHighEntropyValues === 'function'
              ? origUAData.getHighEntropyValues.bind(origUAData)
              : null;

          const proxyUAData = new Proxy(origUAData, {
            get(target, prop) {
              if (prop === 'brands') {
                return cleanBrands;
              }
              if (prop === 'mobile') {
                const val = Reflect.get(target, 'mobile', target);
                return typeof val === 'boolean' ? val : false;
              }
              if (prop === 'platform') {
                return Reflect.get(target, 'platform', target) || platformName;
              }
              if (prop === 'toJSON') {
                return () => {
                  const base = typeof target.toJSON === 'function' ? target.toJSON.call(target) : {};
                  return {
                    ...base,
                    brands: cleanBrands,
                    mobile: false,
                    platform: Reflect.get(target, 'platform', target) || platformName
                  };
                };
              }
              if (prop === 'getHighEntropyValues') {
                return async (hints) => {
                  const result = nativeGetHighEntropyValues
                    ? await nativeGetHighEntropyValues(hints)
                    : {};
                  result.brands = cleanBrands;
                  result.mobile = false;
                  if (!result.platform) {
                    result.platform = platformName;
                  }
                  if (Array.isArray(hints)) {
                    if (hints.includes('fullVersionList')) {
                      result.fullVersionList = cleanFullVersionList;
                    }
                    if (hints.includes('uaFullVersion')) {
                      result.uaFullVersion = chromeFull;
                    }
                  } else {
                    if (result.fullVersionList) {
                      result.fullVersionList = cleanFullVersionList;
                    }
                    if (result.uaFullVersion) {
                      result.uaFullVersion = chromeFull;
                    }
                  }
                  return result;
                };
              }
              const val = Reflect.get(target, prop, target);
              return typeof val === 'function' ? val.bind(target) : val;
            }
          });

          Object.defineProperty(navigator, 'userAgentData', {
            get: () => proxyUAData,
            configurable: true
          });
        }
      } catch (_) {}

      try {
        // 3. Populate standard desktop Chrome properties on window.chrome
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.app) {
          window.chrome.app = {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed'
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running'
            }
          };
        }
        if (!window.chrome.csi) {
          window.chrome.csi = function () {
            return {};
          };
        }
        if (!window.chrome.loadTimes) {
          window.chrome.loadTimes = function () {
            const now = Date.now() / 1000;
            return {
              commitLoadTime: now,
              connectionInfo: 'h2',
              finishDocumentLoadTime: now,
              finishLoadTime: now,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: now,
              navigationType: 'Other',
              requestTime: now,
              startLoadTime: now
            };
          };
        }
        if (!window.chrome.runtime) {
          window.chrome.runtime = {
            OnInstalledReason: {
              CHROME_UPDATE: 'chrome_update',
              INSTALL: 'install',
              SHARED_MODULE_UPDATE: 'shared_module_update',
              UPDATE: 'update'
            },
            OnRestartRequiredReason: {
              APP_UPDATE: 'app_update',
              OS_UPDATE: 'os_update',
              PERIODIC: 'periodic'
            },
            PlatformArch: {
              ARM: 'arm',
              ARM64: 'arm64',
              MIPS: 'mips',
              MIPS64: 'mips64',
              X86_32: 'x86-32',
              X86_64: 'x86-64'
            },
            PlatformNaclArch: {
              ARM: 'arm',
              MIPS: 'mips',
              MIPS64: 'mips64',
              X86_32: 'x86-32',
              X86_64: 'x86-64'
            },
            PlatformOs: {
              ANDROID: 'android',
              CROS: 'cros',
              LINUX: 'linux',
              MAC: 'mac',
              OPENBSD: 'openbsd',
              WIN: 'win'
            },
            RequestUpdateCheckStatus: {
              NO_UPDATE: 'no_update',
              THROTTLED: 'throttled',
              UPDATE_AVAILABLE: 'update_available'
            }
          };
        }
      } catch (_) {}

      try {
        // 4. Populate navigator.plugins if empty
        if (!navigator.plugins || navigator.plugins.length === 0) {
          const dummyPlugins = [
            {
              name: 'PDF Viewer',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format'
            },
            {
              name: 'Chrome PDF Viewer',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format'
            },
            {
              name: 'Chromium PDF Viewer',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format'
            },
            {
              name: 'Microsoft Edge PDF Viewer',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format'
            },
            {
              name: 'WebKit built-in PDF',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format'
            }
          ];
          Object.defineProperty(navigator, 'plugins', {
            get: () => dummyPlugins,
            configurable: true
          });
        }
      } catch (_) {}
    })();
  `;

  if (webFrame && typeof webFrame.executeJavaScriptInIsolatedWorld === 'function') {
    webFrame
      .executeJavaScriptInIsolatedWorld(0, [{ code: MAIN_WORLD_STEALTH_SCRIPT }])
      .catch(() => {});
  } else if (webFrame && typeof webFrame.executeJavaScript === 'function') {
    webFrame.executeJavaScript(MAIN_WORLD_STEALTH_SCRIPT).catch(() => {});
  }
} catch (_) {}
