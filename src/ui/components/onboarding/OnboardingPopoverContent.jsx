import React from 'react';
import { ThemeIcon, Code, Kbd } from '@mantine/core';
import { DiscordSvgIcon } from '../icons/PlatformIcons';

export function OnboardingPopoverContent({
  step = 'login',
  labels = {},
  onSelectExample
}) {
  if (step === 'login') {
    return (
      <div
        className="onboarding-step-content onboarding-step-login"
        data-onboarding-step="login"
      >
        <p className="onboarding-step-desc">{labels.desc}</p>
        <div className="onboarding-platform-list">
          <div
            className="onboarding-platform-row"
            data-platform="twitter"
          >
            <ThemeIcon
              variant="light"
              color="gray"
              size={24}
              radius="md"
              className="onboarding-platform-icon is-twitter"
            >
              𝕏
            </ThemeIcon>
            <div className="onboarding-platform-meta">
              <span className="onboarding-platform-name">Twitter / X</span>
              <span className="onboarding-platform-hint">
                {labels.twitterHint}
              </span>
            </div>
          </div>

          <div
            className="onboarding-platform-row"
            data-platform="threads"
          >
            <ThemeIcon
              variant="light"
              color="gray"
              size={24}
              radius="md"
              className="onboarding-platform-icon is-threads"
            >
              @
            </ThemeIcon>
            <div className="onboarding-platform-meta">
              <span className="onboarding-platform-name">Threads</span>
              <span className="onboarding-platform-hint">
                {labels.threadsHint}
              </span>
            </div>
          </div>

          <div
            className="onboarding-platform-row"
            data-platform="discord"
          >
            <ThemeIcon
              variant="light"
              color="indigo"
              size={24}
              radius="md"
              className="onboarding-platform-icon is-discord"
            >
              <DiscordSvgIcon />
            </ThemeIcon>
            <div className="onboarding-platform-meta">
              <span className="onboarding-platform-name">Discord</span>
              <span className="onboarding-platform-hint">
                {labels.discordHint}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleExampleClick = (exampleVal) => {
    if (typeof onSelectExample === 'function') {
      onSelectExample(exampleVal);
    }
  };

  return (
    <div
      className="onboarding-step-content onboarding-step-input"
      data-onboarding-step="input"
    >
      <p className="onboarding-step-desc">{labels.desc}</p>

      <div className="onboarding-formats-list" id="onboarding-formats-list">
        {/* 1. Twitter / X Input Format */}
        <div
          className="onboarding-format-card"
          data-platform="twitter"
        >
          <div className="onboarding-format-header">
            <ThemeIcon
              variant="light"
              color="gray"
              size={22}
              radius="md"
              className="onboarding-platform-icon is-twitter"
            >
              𝕏
            </ThemeIcon>
            <span className="onboarding-format-title">
              {labels.twitterTitle || 'Twitter / X'}
            </span>
            <span className="onboarding-format-desc">
              {labels.twitterDesc}
            </span>
          </div>
          <div className="onboarding-format-examples">
            {['elonmusk', '@OpenAI', 'x.com/karpathy'].map((ex) => (
              <Code
                key={ex}
                className="onboarding-format-code"
                data-example={ex}
                onClick={() => handleExampleClick(ex)}
              >
                {ex}
              </Code>
            ))}
          </div>
        </div>

        {/* 2. Threads Input Format */}
        <div
          className="onboarding-format-card"
          data-platform="threads"
        >
          <div className="onboarding-format-header">
            <ThemeIcon
              variant="light"
              color="gray"
              size={22}
              radius="md"
              className="onboarding-platform-icon is-threads"
            >
              @
            </ThemeIcon>
            <span className="onboarding-format-title">
              {labels.threadsTitle || 'Threads'}
            </span>
            <span className="onboarding-format-desc">
              {labels.threadsDesc}
            </span>
          </div>
          <div className="onboarding-format-examples">
            {['threads:@zuck', 'threads.com/@mosseri'].map((ex) => (
              <Code
                key={ex}
                className="onboarding-format-code"
                data-example={ex}
                onClick={() => handleExampleClick(ex)}
              >
                {ex}
              </Code>
            ))}
          </div>
        </div>

        {/* 3. Discord Channel Link Format */}
        <div
          className="onboarding-format-card"
          data-platform="discord"
        >
          <div className="onboarding-format-header">
            <ThemeIcon
              variant="light"
              color="indigo"
              size={22}
              radius="md"
              className="onboarding-platform-icon is-discord"
            >
              <DiscordSvgIcon />
            </ThemeIcon>
            <span className="onboarding-format-title">
              {labels.discordTitle || 'Discord'}
            </span>
            <span className="onboarding-format-desc">
              {labels.discordDesc}
            </span>
          </div>
          <div className="onboarding-format-examples">
            <Code
              className="onboarding-format-code is-url"
              data-example="https://discord.com/channels/100000000000000001/200000000000000002"
              onClick={() =>
                handleExampleClick(
                  'https://discord.com/channels/100000000000000001/200000000000000002'
                )
              }
            >
              https://discord.com/channels/100000000000000001/200000000000000002
            </Code>
          </div>
        </div>
      </div>

      <div className="onboarding-step-tip">
        <Kbd size="xs" className="onboarding-kbd">
          Enter
        </Kbd>
        <span>{labels.footerTip}</span>
      </div>
    </div>
  );
}
