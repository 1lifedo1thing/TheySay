import React from 'react';
import { Box, Badge } from '@mantine/core';
import {
  IconPinFilled,
  IconPinnedOff,
  IconArrowUpRight,
  IconChevronUp,
  IconChevronDown
} from '@tabler/icons-react';

export function SlotPinnedBar({
  items = [],
  isCollapsed = false,
  collapsedCountLabel = '',
  collapseTitle = '',
  expandTitle = '',
  onMarkRead,
  onOpenExternal,
  onPrefetch,
  onOpenPopup,
  onUnpin,
  onToggleCollapse
}) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  if (isCollapsed) {
    const latest = items[items.length - 1] || items[0];
    const latestBody = latest ? latest.body : null;
    const latestHtml =
      latestBody && latestBody.text
        ? latestBody.text.fullHtml || latestBody.text.html
        : '';
    return (
      <Box
        className="slot-pinned-collapsed-bar"
        title={expandTitle}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onToggleCollapse === 'function') {
            onToggleCollapse();
          }
        }}
      >
        <span className="slot-pinned-accent-bar" aria-hidden="true" />
        <span className="slot-pinned-icon-wrap" aria-hidden="true">
          <IconPinFilled size={11} className="slot-pinned-icon" />
        </span>
        <span className="slot-pinned-count slot-pinned-count-badge">{collapsedCountLabel}</span>
        <Box className="slot-pinned-collapsed-preview">
          {latest && latest.isDiscord && latestBody && latestBody.authorName && (
            <span
              className="slot-pinned-author"
              style={{ color: latestBody.authorColor }}
            >
              {`${latestBody.authorName}: `}
            </span>
          )}
          {latestHtml ? (
            <span
              className="slot-pinned-text"
              dangerouslySetInnerHTML={{ __html: latestHtml }}
            />
          ) : (
            latest &&
            latest.hasMedia && (
              <span className="slot-pinned-attachment">
                {latest.imageAlt || ''}
              </span>
            )
          )}
        </Box>
        <button
          type="button"
          className="slot-pinned-btn slot-pinned-btn-expand"
          title={expandTitle}
          aria-label={expandTitle}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof onToggleCollapse === 'function') {
              onToggleCollapse();
            }
          }}
        >
          <IconChevronDown size={12} stroke={2.4} />
        </button>
      </Box>
    );
  }

  return (
    <Box className="slot-pinned-list">
      {items.map((item, idx) => {
        const {
          post,
          isDiscord,
          isThreads,
          isMemberOnly,
          hasPopup,
          hasMedia,
          images,
          imageAlt,
          timeDisplay,
          linkUrl,
          linkTitle,
          unpinTitle,
          body
        } = item;

        const rowClasses = ['slot-pinned-item'];
        if (isDiscord) rowClasses.push('discord');
        else if (isThreads) rowClasses.push('threads');
        if (isMemberOnly) rowClasses.push('is-member-only');
        if (hasPopup) rowClasses.push('has-popup');

        const visibleTags =
          body && Array.isArray(body.tags)
            ? body.tags.filter((tg) => tg && tg.type !== 'pinned')
            : [];
        const textHtml =
          body && body.text ? body.text.fullHtml || body.text.html : '';

        return (
          <Box
            key={item.key || idx}
            ref={(el) => {
              if (el) {
                el._post = post;
                el._isDiscord = isDiscord;
              }
            }}
            className={rowClasses.join(' ')}
            onMouseEnter={(e) => {
              const rowEl = e.currentTarget;
              if (typeof onMarkRead === 'function') {
                onMarkRead(post, rowEl);
              }
              if (
                hasPopup &&
                !isDiscord &&
                !isThreads &&
                typeof onPrefetch === 'function'
              ) {
                onPrefetch(post);
              }
            }}
            onClick={(e) => {
              if (
                e.target &&
                typeof e.target.closest === 'function' &&
                e.target.closest('.slot-pinned-actions')
              ) {
                return;
              }
              const rowEl = e.currentTarget;
              if (typeof onMarkRead === 'function') {
                onMarkRead(post, rowEl);
              }
              if (hasPopup && typeof onOpenPopup === 'function') {
                onOpenPopup(post);
              }
            }}
          >
            <span className="slot-pinned-accent-bar" aria-hidden="true" />
            <span className="slot-pinned-icon-wrap" aria-hidden="true">
              <IconPinFilled size={11} className="slot-pinned-icon" />
            </span>

            <Box className="slot-pinned-body">
              {isDiscord && body && body.authorName && (
                <span
                  className="slot-pinned-author"
                  style={{ color: body.authorColor }}
                >
                  {`${body.authorName}: `}
                </span>
              )}

              {visibleTags.map((tag, tIdx) => (
                <Badge
                  key={`${tag.type}-${tIdx}`}
                  component="span"
                  variant="light"
                  size="xs"
                  radius="xs"
                  className={`tweet-tag ${tag.type}`}
                  title={tag.title || undefined}
                >
                  {tag.label}
                </Badge>
              ))}

              {body && body.reply && (
                <span className="slot-pinned-reply">
                  {`↩ ${body.reply.author || ''} `}
                </span>
              )}

              {textHtml ? (
                <span
                  className="slot-pinned-text im-text-content"
                  dangerouslySetInnerHTML={{ __html: textHtml }}
                />
              ) : body &&
                Array.isArray(body.attachments) &&
                body.attachments.length > 0 ? (
                <span className="slot-pinned-attachment">
                  {body.attachments.join(' · ')}
                </span>
              ) : (
                hasMedia && (
                  <span className="slot-pinned-attachment">
                    {imageAlt || ''}
                  </span>
                )
              )}
            </Box>

            {hasMedia && Array.isArray(images) && images[0] && (
              <img
                className="slot-pinned-thumb"
                src={images[0]}
                alt={imageAlt || ''}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}

            {timeDisplay && (
              <span className="slot-pinned-time">{timeDisplay}</span>
            )}

            <Box className="slot-pinned-actions">
              {idx === 0 && (
                <button
                  type="button"
                  className="slot-pinned-btn slot-pinned-btn-collapse"
                  title={collapseTitle}
                  aria-label={collapseTitle}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof onToggleCollapse === 'function') {
                      onToggleCollapse();
                    }
                  }}
                >
                  <IconChevronUp size={12} stroke={2.4} />
                </button>
              )}

              {linkUrl && (
                <a
                  className="slot-pinned-btn slot-pinned-btn-link"
                  data-url={linkUrl}
                  title={linkTitle}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rowEl = e.currentTarget.closest('.slot-pinned-item');
                    if (typeof onMarkRead === 'function') {
                      onMarkRead(post, rowEl);
                    }
                    if (typeof onOpenExternal === 'function') {
                      onOpenExternal(linkUrl);
                    }
                  }}
                >
                  <IconArrowUpRight size={11} stroke={2.4} />
                </a>
              )}

              <button
                type="button"
                className="slot-pinned-btn slot-pinned-btn-unpin"
                title={unpinTitle}
                aria-label={unpinTitle}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (typeof onUnpin === 'function') {
                    onUnpin(post);
                  }
                }}
              >
                <IconPinnedOff size={11} stroke={2.3} />
              </button>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
