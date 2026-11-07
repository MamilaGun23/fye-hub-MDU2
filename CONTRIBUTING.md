# Contributing

Use Node.js 22+, run `npm ci`, and make changes on a focused branch. Run `npm test` before submitting a pull request. For portfolio changes, run `npm run test:portfolio` and regenerate screenshots if the visible presentation changed.

Keep role routing consistent with the database workflow: interface restrictions never replace SQL permissions. For database changes, document prerequisites and affected policies/functions, and test against a separate authorised project. Do not treat historical aggregate SQL files as a fresh-database installer.

Use synthetic records in screenshots and fixtures. Keep `.env`, `.env.demo`, `.demo-seed/`, service-role keys, academic evidence, and student records out of commits. Preserve the original MIT attribution.

Pull requests should describe the user-visible result, affected workflows, checks run, and any deployment prerequisites. Document unsupported cases honestly; do not quote planned demo cohort sizes as real adoption.
