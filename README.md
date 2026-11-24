> [!NOTE]
> Editor isn't a plugin for site owners to install. It's a library for your own Craft plugins and modules, and it arrives on a site as a dependency of the plugin that uses it, such as [Comments](https://github.com/verbb/comments).

<p align="center"><img src="https://assets.verbb.io/plugins/editor/editor-icon.svg" width="100" height="100" alt="Editor icon"></p>
<h1 align="center">Editor for Craft CMS</h1>

Editor is a Craft CMS library that gives your plugins and modules a front-end rich-text editor, along with the server code that sanitises and renders what people write. When your plugin lets people write something on the front end, such as a comment, a reply or a message, Editor provides the editor they write in and checks everything it sends. Your plugin keeps its own records, permissions and notifications.

## Features

- A clear writing area with its tools in a row under the text, a toolbar above any selected words, and Markdown shortcuts.
- Presets and per-context settings that choose which features each editor offers and the order of its tools.
- One link control for any address or a page on your Craft site.
- Mentions, with suggestions showing each person's photo or initials, name and a line about them.
- Photo and file uploads in a tray under the text, with progress, alt text and retries. Photos lose their metadata, including where they were taken, before they're stored.
- GIF search through GIPHY, for contexts that turn it on.
- A Post button, character limits, saved drafts and error messages, while your own code does the posting.
- Four themes that take your site's colours, with collapsed, borderless and narrow layouts.
- Server-side sanitising and rendering, so a saved document only ever contains what its context allows.
- The `@verbb/editor` npm package and `<verbb-editor>` element for front ends you build yourself.

## Documentation

Visit the [Editor documentation](https://docs.verbb.io/editor/) for all documentation, guides and developer resources.

## Support

Get in touch with us by [creating a GitHub issue](https://github.com/verbb/editor/issues).

## Sponsor

Editor is licensed under the MIT license, so it will always be free and open source. If you'd like to support it anyway, you can [sponsor its development](https://github.com/sponsors/verbb).

<h2></h2>

<a href="https://verbb.io" target="_blank">
    <img width="101" height="33" src="https://verbb.io/assets/img/verbb-pill.svg" alt="Verbb">
</a>
