# Contribute documentation

Documentation is part of the installed product. Markdown is canonical; every interface reads the same structured corpus.

## Add a page

1. Choose `docs/product/` for user/operator content, `docs/development/` for contribution content, or `docs/modules/<module>/` for a module's own pages.
2. Decide whether the reader is learning, performing a task, consulting a contract, or understanding a concept.
3. Write one H1 and a concise introduction. Add prerequisites and expected results to procedures when useful.
4. Register the source, stable slug and description in `docs/navigation.json`, or in the module's own `navigation.json` for a module page. Array position determines order; the group determines audience and category. Markdown titles come only from H1.
5. Run `npm run docs:generate`, then `npm run docs:check`.

Do not add front matter, numbered filenames for order, or unpublished files to the public roots. Internal instructions and research are repository-only. A new public page without classification fails validation.

## Writing and examples

Use English. Use Project, Environment and Service for named Portta entities; commands and configuration keys keep their exact spelling. Concepts use nouns, procedures use verbs, and references name their subject.

Use `demo-shop` for a Project, `development` for its purpose, `demo-shop-development` for the Compose namespace and `web` for its HTTP service. Read actual URLs from `portta urls`.

Keep paragraphs short. A reference uses tables and contracts; a tutorial uses ordered steps and expected results. Link to the canonical explanation instead of repeating it. Commands use `bash` fences without `$`; output uses a separate `text` fence. Use descriptive link labels.

## Markdown features

Relative links work on GitHub and resolve to stable panel URLs. Use H2 and H3 for normal sections. Anchors follow GitHub heading rules; repeated headings gain numeric suffixes. Images live in `docs/images/` with meaningful alt text. Mermaid fences render locally and retain readable source on failure.

Use GitHub alerts: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`. Reserve `CAUTION` for data loss, exposure or significant operational impact. State requirements or experimental status explicitly in the alert text.

## Architecture

`navigation.json` defines audience, groups, descriptions and stable public slugs. Core provides pure compilation and query functions. The build reads sources and validates links, then emits a versioned corpus. The server loads that corpus for the API; Next renders its Markdown. In development, the server compiles source changes in memory because the documentation mount is read-only. CLI and MCP query the bundled corpus locally or an explicitly selected panel.

The README index and citation map are generated outputs. Never edit them independently. Public content must work offline and match the installed version. Internal research, agent instructions and audits are never included in the published corpus.

## Validation

Run the documentation check for content changes. Add focused tests when changing compilation, search or interfaces. Test keyboard navigation, mobile navigation, focus, TOC and both themes when changing those interactions. Broad regression belongs to integration and release milestones.
