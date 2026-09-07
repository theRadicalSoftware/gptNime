# GPTNime Quick Read

GPTNime is a local-first anime watch ledger built with Vite, React, and TypeScript. It tracks library progress, ratings, favorites, rewatches, episode memory, smart shelves, fan stats, notifications, and the GPTNime Cinema player.

Use [`README.md`](README.md) for setup, feature details, storage notes, and project structure. Use [`docs/EASTER_EGGS.md`](docs/EASTER_EGGS.md) for the subtle easter eggs and quiet UX touches.

The cinema opens from Watch actions or the floating TV. Files and direct video URLs play inside the app, with docking, pop-out / pop-in, subtitles, and resume. WCO search and saved pages open in a provider-owned window because WCO excludes localhost from its embedding policy. See [`docs/CINEMA.md`](docs/CINEMA.md) for implementation boundaries and verification.
