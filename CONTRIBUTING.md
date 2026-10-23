# Contributing

Thanks for your interest in Immich TV for Samsung, an unofficial, read-only Samsung Tizen TV client for Immich.

## Before you start

- **Open an issue first** for anything bigger than a small fix, so we can agree the approach before you spend time on it.
- **The app is read-only.** Uploading, editing, deleting and administration stay in Immich.
- **It targets Tizen 4.0 (2018 Samsung TVs), whose browser engine is Chromium 56.** Code that works in a current browser can still fail on the TV. The build and lint checks enforce the Chromium 56 rules; don't work around them.
- **Everything must work with the Samsung Smart Remote alone:** arrows, OK, Back and Play/Pause. There is no mouse, touch or hover on a TV.
- `docs/project-brief.md` holds the roadmap and current status. `AGENTS.md` holds the project's engineering rules, written for both people and AI coding agents. `docs/architecture/` holds the decision records.

## Setup

You need Node.js 22. The exact version is in `.nvmrc`.

```sh
npm ci
npm run preview
```

`npm run preview` serves the app for desktop testing. See `README.md` for the preview's Immich proxy, and `docs/toolchain.md` for Tizen Studio and deploying to a TV.

For your own TV, copy `.env.tizen.example` to `.env.tizen` and fill in your values. That file is ignored by git.

## Checks

Run these before opening a pull request. CI runs the same set.

```sh
npm run typecheck
npm run format:check
npm run lint
npm run test:coverage
npm run build
npm run check
npm run stage:tizen
```

`npm run format` fixes formatting and simple lint issues.

## Pull requests

- Keep each pull request to one coherent change, with a description of what changed and why.
- Add or update tests for behaviour changes.
- Update the docs when you change how something works.
- Changes that depend on TV behaviour are tested by the maintainer on a physical Samsung TV before release. Say in your pull request what you couldn't test.

## Privacy

Never commit, or post in issues or pull requests:

- API keys, passwords or tokens;
- private server addresses;
- signing certificates or certificate profile details;
- photos, names or faces from a personal library.

Screenshots and recordings must come from a demo library. See `docs/capture.md`.

## Licence

By contributing, you agree that your contributions are licensed under the MIT Licence in `LICENSE`.
