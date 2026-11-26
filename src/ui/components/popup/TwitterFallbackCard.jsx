import React from 'react';
import { Paper, Box, Badge, Button, Avatar } from '@mantine/core';
import { PopupImageGallery } from './PopupImageGallery';

export function TwitterFallbackCard({
  avatarUrl = '',
  displayName = '',
  userHandle = '',
  isMemberOnly = false,
  effectiveTextHtml = '',
  articleBlocks = [],
  isLoadingDetail = false,
  images = [],
  hasQuote = false,
  quoteUrl = '',
  timeDisplay = '',
  postUrl = '',
  labels = {},
  onOpenExternal
}) {
  const handleCardClick = (e) => {
    const targetEl = e.target.closest('[data-url]');
    if (!targetEl) return;
    e.preventDefault();
    const url = targetEl.getAttribute('data-url');
    if (url && typeof onOpenExternal === 'function') {
      onOpenExternal(url);
    }
  };

  const hasArticleBlocks = Array.isArray(articleBlocks) && articleBlocks.length > 0;
  const cleanHandle = String(userHandle || '').replace(/^@+/, '').trim();
  const profileUrl = /^[A-Za-z0-9_]+$/.test(cleanHandle) ? `https://x.com/${cleanHandle}` : '';

  return (
    <Paper
      className="tweet-popup-fallback"
      radius={16}
      withBorder
      onClick={handleCardClick}
    >
      <Box className="tweet-popup-fallback-header">
        <Avatar
          size={38}
          radius="xl"
          color="dark"
          variant="filled"
          src={avatarUrl || null}
          className={`tweet-popup-fallback-avatar${profileUrl ? ' is-clickable' : ''}`}
          data-url={profileUrl || undefined}
          imageProps={{ referrerPolicy: 'no-referrer' }}
        >
          𝕏
        </Avatar>
        <Box
          className={`tweet-popup-fallback-names${profileUrl ? ' is-clickable' : ''}`}
          data-url={profileUrl || undefined}
        >
          <span className="tweet-popup-fallback-name">{displayName}</span>
          <span className="tweet-popup-fallback-handle">{userHandle}</span>
        </Box>
      </Box>

      {isMemberOnly && (
        <Box className="tweet-popup-fallback-member">
          <Badge
            component="span"
            variant="light"
            color="yellow"
            radius={4}
            className="tweet-tag member"
          >
            {labels.memberOnlyTag}
          </Badge>
          <span className="tweet-member-notice">{labels.memberOnlyNotice}</span>
        </Box>
      )}

      {isLoadingDetail && (
        <Box className="tweet-popup-fallback-loading">
          <span className="spinner-small" />
          <span>{labels.loadingFullContent}</span>
        </Box>
      )}

      {hasArticleBlocks ? (
        <Box className="tweet-popup-fallback-article">
          {articleBlocks.map((b, idx) => {
            if (!b) return null;
            if (b.type === 'image' && b.url) {
              return (
                <Box key={`img-${idx}`} className="discord-popup-image-wrap">
                  <img
                    className="discord-popup-image"
                    src={b.url}
                    alt={labels.imageAlt}
                    referrerPolicy="no-referrer"
                    data-url={b.url}
                    title={labels.viewOriginalImageTitle}
                    onError={(e) => {
                      const wrap = e.currentTarget.closest('.discord-popup-image-wrap');
                      if (wrap) wrap.style.display = 'none';
                    }}
                  />
                </Box>
              );
            }
            if (b.type === 'title' && b.html) {
              return (
                <Box
                  key={`title-${idx}`}
                  className="tweet-popup-fallback-article-title tweet-popup-fallback-text"
                  dangerouslySetInnerHTML={{ __html: b.html }}
                />
              );
            }
            if (b.type === 'heading' && b.html) {
              return (
                <Box
                  key={`heading-${idx}`}
                  className="tweet-popup-fallback-article-heading tweet-popup-fallback-text"
                  dangerouslySetInnerHTML={{ __html: b.html }}
                />
              );
            }
            if (b.html) {
              return (
                <Box
                  key={`txt-${idx}`}
                  className="tweet-popup-fallback-text"
                  dangerouslySetInnerHTML={{ __html: b.html }}
                />
              );
            }
            return null;
          })}
        </Box>
      ) : (
        <>
          {effectiveTextHtml && (
            <Box
              className="tweet-popup-fallback-text"
              dangerouslySetInnerHTML={{ __html: effectiveTextHtml }}
            />
          )}

          <PopupImageGallery
            images={images}
            imageAlt={labels.imageAlt}
            viewOriginalImageTitle={labels.viewOriginalImageTitle}
          />
        </>
      )}

      {hasQuote && (
        <Box className="tweet-popup-fallback-quote">
          <Badge
            component="span"
            variant="light"
            color="grape"
            radius={4}
            className="tweet-tag quote"
          >
            {labels.quoteTag}
          </Badge>
          {quoteUrl && (
            <a
              href="#"
              className="tweet-fallback-quote-link"
              data-url={quoteUrl}
            >
              {labels.viewQuotedPost}
            </a>
          )}
        </Box>
      )}

      <Box className="tweet-popup-fallback-footer">
        <span className="tweet-popup-fallback-time">{timeDisplay}</span>
        {postUrl && (
          <Button
            variant="light"
            color="brand"
            size="compact-xs"
            radius="sm"
            className="tweet-popup-fallback-btn"
            data-url={postUrl}
          >
            {labels.openOnTwitter}
          </Button>
        )}
      </Box>
    </Paper>
  );
}
