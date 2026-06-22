# GPTNime Design Notes

These notes capture project-level UI decisions that should remain consistent across future work.

## Scrollbars

- Scrollbars should be quiet, dark, and integrated with the existing gold/teal accent system.
- Use the global scrollbar styling in `src/index.css`; do not add bright native scrollbars or one-off high-contrast scroll tracks for individual panels.
- Scrollable panels should reserve a stable gutter when content is dense, especially detail panels, episode lists, drawers, and modals.
- Scrollbar thumbs should remain subtle by default and become only slightly brighter on hover. Avoid heavy borders, white tracks, or oversized browser-default controls.

## Generated Shelf Art

- Generated art should be used as restrained atmosphere inside functional surfaces, not as a loud mascot mode.
- Keep generated shelf art original, unbranded, and free of recognizable anime characters, logos, or readable titles.
- Favor dark cinematic crops with the existing gold/teal accent language so the art supports the interface instead of competing with titles and actions.

## App Icon

- The GPTNime app icon is a generated retro anime-channel TV mark with a gold frame, teal screen glow, red control accent, and small sparkle.
- Keep icon variants text-free and readable at 16px, 32px, and launcher sizes. Avoid character art, readable anime titles, or dense background detail.
- Browser and installable app metadata should use the PNG/ICO stack in `public/` plus `public/site.webmanifest`; do not reintroduce a generic Vite SVG favicon.
