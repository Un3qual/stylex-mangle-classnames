# Changesets

Add a changeset for changes that affect package users:

```sh
pnpm changeset
```

Select `@un3qual/stylex-mangle-classnames`, choose the appropriate semantic-version impact, and describe the user-visible change. Commit the generated Markdown file with the change it documents.

Documentation, tests, CI, and other repository-only maintenance do not need a changeset.

Changesets record future versions and changelog entries. Publishing remains a separate, manual maintainer action.
