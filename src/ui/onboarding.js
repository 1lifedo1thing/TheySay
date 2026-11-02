const { ipcRenderer } = require('electron');
const { driver } = require('driver.js');
const {
  getOnboardingCompleted,
  saveOnboardingCompleted
} = require('../core/storage');
const { t } = require('../core/i18n');
const { updateSlotSourceUI } = require('./slot');
const { renderMantineOnboardingContent } = require('./dist/mantine-shell');

let activeDriver = null;
let boundSlots = [];
let globalEscapeBound = false;
let restoredSlot0AuthorMode = false;

function ensureSlot0InputVisible() {
  const slot0 = boundSlots && boundSlots[0];
  const cardEl = (slot0 && slot0.card) || document.getElementById('slot-card-0');
  const headerEl =
    (slot0 && slot0.header) ||
    (cardEl && cardEl.querySelector('.slot-header'));
  const authorHeaderEl =
    (slot0 && slot0.authorHeader) ||
    document.getElementById('slot-author-header-0');
  const inputWrapperEl =
    (slot0 && slot0.inputWrapper) ||
    document.getElementById('slot-input-wrapper-0');

  if (cardEl) {
    cardEl.classList.remove('is-header-hidden');
  }
  if (headerEl) {
    headerEl.classList.add('has-open-menu');
  }
  if (
    inputWrapperEl &&
    inputWrapperEl.style.display === 'none' &&
    authorHeaderEl &&
    authorHeaderEl.style.display !== 'none'
  ) {
    restoredSlot0AuthorMode = true;
    authorHeaderEl.style.display = 'none';
    inputWrapperEl.style.display = 'flex';
  }
  return inputWrapperEl || headerEl || cardEl;
}

function restoreSlot0HeaderState() {
  const slot0 = boundSlots && boundSlots[0];
  const cardEl = (slot0 && slot0.card) || document.getElementById('slot-card-0');
  const headerEl =
    (slot0 && slot0.header) ||
    (cardEl && cardEl.querySelector('.slot-header'));
  const authorHeaderEl =
    (slot0 && slot0.authorHeader) ||
    document.getElementById('slot-author-header-0');
  const inputWrapperEl =
    (slot0 && slot0.inputWrapper) ||
    document.getElementById('slot-input-wrapper-0');

  if (headerEl) {
    headerEl.classList.remove('has-open-menu');
  }
  if (restoredSlot0AuthorMode) {
    restoredSlot0AuthorMode = false;
    if (
      slot0 &&
      Array.isArray(slot0.loadedPosts) &&
      slot0.loadedPosts.length > 0
    ) {
      if (authorHeaderEl) authorHeaderEl.style.display = 'flex';
      if (inputWrapperEl) inputWrapperEl.style.display = 'none';
    }
  }
}

function handleSelectFormatExample(exampleValue) {
  if (!exampleValue) return;
  const slot0 = boundSlots && boundSlots[0];
  const inputEl =
    (slot0 && slot0.handleInput) || document.getElementById('handle-input-0');
  const clearBtn =
    (slot0 && slot0.btnClear) || document.getElementById('btn-clear-0');
  if (!inputEl) return;

  inputEl.value = exampleValue;
  if (clearBtn) {
    clearBtn.style.display = exampleValue.length > 0 ? 'flex' : 'none';
  }
  if (slot0) {
    updateSlotSourceUI(slot0);
  }
}

function buildOnboardingSteps() {
  return [
    {
      element: '#btn-login-menu',
      popover: {
        title: t('onboarding.step1.title'),
        description: t('onboarding.step1.desc'),
        side: 'right',
        align: 'start',
        popoverClass: 'theysay-onboarding-popover onboarding-popover-step-1',
        onPopoverRender: (popover) => {
          if (popover && popover.description) {
            renderMantineOnboardingContent(popover.description, {
              step: 'login',
              labels: {
                desc: t('onboarding.step1.desc'),
                twitterHint: t('onboarding.step1.twitterHint'),
                threadsHint: t('onboarding.step1.threadsHint'),
                discordHint: t('onboarding.step1.discordHint')
              }
            });
          }
        }
      }
    },
    {
      element: () =>
        ensureSlot0InputVisible() ||
        document.getElementById('slot-input-wrapper-0') ||
        '#slot-card-0',
      onHighlightStarted: () => {
        ensureSlot0InputVisible();
      },
      onDeselected: () => {
        restoreSlot0HeaderState();
      },
      popover: {
        title: t('onboarding.step2.title'),
        description: t('onboarding.step2.desc'),
        side: 'bottom',
        align: 'start',
        popoverClass: 'theysay-onboarding-popover onboarding-popover-step-2',
        onPopoverRender: (popover) => {
          if (popover && popover.description) {
            renderMantineOnboardingContent(popover.description, {
              step: 'input',
              labels: {
                desc: t('onboarding.step2.desc'),
                twitterTitle: t('onboarding.step2.twitterTitle'),
                twitterDesc: t('onboarding.step2.twitterDesc'),
                threadsTitle: t('onboarding.step2.threadsTitle'),
                threadsDesc: t('onboarding.step2.threadsDesc'),
                discordTitle: t('onboarding.step2.discordTitle'),
                discordDesc: t('onboarding.step2.discordDesc'),
                footerTip: t('onboarding.step2.footerTip')
              },
              onSelectExample: handleSelectFormatExample
            });
          }
        }
      }
    }
  ];
}

function isOnboardingActive() {
  return Boolean(activeDriver && activeDriver.isActive());
}

function stopOnboardingTour() {
  if (activeDriver) {
    try {
      if (activeDriver.isActive()) {
        activeDriver.destroy();
      }
    } catch (_) {}
    activeDriver = null;
  }
  restoreSlot0HeaderState();
  saveOnboardingCompleted(true);
}

function startOnboardingTour({ slots, force = false, startIndex = 0 } = {}) {
  if (Array.isArray(slots)) {
    boundSlots = slots;
  }
  if (!force && getOnboardingCompleted()) {
    return null;
  }
  if (typeof document === 'undefined') return null;

  const loginBtn = document.getElementById('btn-login-menu');
  const slotInput =
    document.getElementById('slot-input-wrapper-0') ||
    document.getElementById('slot-card-0');
  if (!loginBtn || !slotInput) return null;

  if (activeDriver && activeDriver.isActive()) {
    try {
      activeDriver.destroy();
    } catch (_) {}
  }

  activeDriver = driver({
    animate: true,
    duration: 300,
    smoothScroll: false,
    allowClose: true,
    overlayClickBehavior: 'close',
    overlayOpacity: 0.58,
    stagePadding: 5,
    stageRadius: 8,
    popoverOffset: 10,
    showProgress: true,
    progressText: t('onboarding.progressText', {
      current: '{{current}}',
      total: '{{total}}'
    }),
    nextBtnText: t('onboarding.nextBtn'),
    prevBtnText: t('onboarding.prevBtn'),
    doneBtnText: t('onboarding.doneBtn'),
    closeBtnLabel: t('onboarding.closeBtnLabel'),
    showButtons: ['next', 'previous', 'close'],
    steps: buildOnboardingSteps(),
    onDestroyed: () => {
      restoreSlot0HeaderState();
      saveOnboardingCompleted(true);
      activeDriver = null;
    }
  });

  activeDriver.drive(startIndex);
  return activeDriver;
}

function refreshOnboardingLocaleUI() {
  if (!activeDriver || !activeDriver.isActive()) return;
  const currentIdx = activeDriver.getActiveIndex() || 0;
  startOnboardingTour({
    slots: boundSlots,
    force: true,
    startIndex: currentIdx
  });
}

function initOnboarding({ slots = [] } = {}) {
  boundSlots = slots;

  if (!globalEscapeBound && ipcRenderer) {
    globalEscapeBound = true;
    ipcRenderer.on('global-escape', () => {
      if (isOnboardingActive()) {
        stopOnboardingTour();
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.__THEYSAY_ONBOARDING = {
      start: (opts = {}) =>
        startOnboardingTour({ slots: boundSlots, force: true, ...opts }),
      stop: () => stopOnboardingTour(),
      isActive: () => isOnboardingActive()
    };
  }

  if (!getOnboardingCompleted()) {
    startOnboardingTour({ slots, force: false });
  }
}

module.exports = {
  initOnboarding,
  startOnboardingTour,
  stopOnboardingTour,
  isOnboardingActive,
  refreshOnboardingLocaleUI
};
