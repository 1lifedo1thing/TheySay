# TheySay — All the Voices on One Screen

[English](README.md) | [简体中文](docs/README_zh.md) | [日本語](docs/README_ja.md)

Stop jumping between endless browser tabs and apps. **TheySay** brings your favorite **X (Twitter)** accounts, **Threads** creators, and **Discord** channels together into a single, customizable desktop dashboard.

![How TheySay Aggregates X, Threads, and Discord into One Screen](docs/overview-diagram.svg)

App screenshot:

![TheySay Dashboard Screenshot](docs/screenshot.png)

## Download

Download the latest installer for **macOS**, **Windows**, or **Linux** from **[GitHub Releases](https://github.com/laike9m/TheySay/releases/latest)**.

## Highlights

- **One Screen for Every Account (`1×1` to `4×4` Layouts)**: Watch real-time updates from multiple followed accounts side by side in a single view. Choose any grid layout from `1×1` up to `4×4`, freely drag (with horizontal block-swapping so moving taller or shorter cards sideways replaces positions cleanly instead of pushing cards up or down), resize, close extra cards to craft asymmetric layouts, or click the `+` button in any empty grid area to add a new panel on the spot (with multi-step `Cmd+Z` / `Ctrl+Z` layout undo and `Cmd+Shift+Z` / `Ctrl+Shift+Z` redo), and type any username to quickly add accounts across X and Threads—or paste a link to follow any public or private Discord channel.

- **Distraction-Free Chat-Style Reading, Full Local History & Pinning**: Updates appear in clean, chronological chat bubbles instead of cluttered social media timelines, with all scraped historical messages preserved locally in SQLite so older updates never disappear as new ones arrive. Web links automatically display readable page titles, images sit neatly beside the text, clicking any message opens the full post, quoted thread, or high-resolution media in a focused popup reader, and you can pin one or multiple key posts right below any card's header for quick reference.

- **Built for Market & Tech Watchers**: Automatically recognizes and highlights US stock, ETF, and crypto tickers (such as `$NVDA`, `$TSLA`, `$BTC`) with customizable badge colors so market-moving mentions stand out at a glance. Want less noise? Add mute keywords or phrases in Settings to hide unwanted topics automatically.

- **Never Miss an Update**: Unread counters on each card and on your system Dock / taskbar icon show exactly where new posts have arrived. Enable desktop notifications only for your highest-priority accounts while keeping the rest silent, or clear everything with a single click.

- **Personalized & Portable**: Switch effortlessly between Light and Dark themes, customize card and bubble colors, set independent auto-refresh intervals for each platform, receive automatic cross-platform version updates from GitHub Releases, and export or import your entire dashboard layout and followed list as a `.json` backup file anytime.

## Quick Start

On your first launch, an interactive spotlight guide (`driver.js`) walks you through signing in and showcases all three supported input formats right inside a single pop-up:

1. **Connect Your Accounts**: Use the left sidebar to sign in to X, Threads, or Discord (your session stays 100% local on your device).
2. **Set Up Your Grid**: Use the visual 4×4 grid picker in the sidebar to choose any layout from `1×1` to `4×4` (such as `2×3`, `3×2`, or `1×4`), then click any card header to enter an `@handle` (`elonmusk`, `@OpenAI`), a Threads profile (`threads:@zuck`, `threads.com/@mosseri`), or a Discord channel link (`https://discord.com/channels/...`).
3. **Customize Your Workflow**: Click the bell icon on any card to toggle desktop notifications, or open **Settings** to adjust refresh intervals, ticker colors, language (`English` / `中文`), and keyword filters.

## License

Licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.
