# Writing & Formatting

The writing area stays clear. Tools sit in a row under the text, and the common ones also float above any words you select. Post stays muted until there's something to post.

## The Toolbar

Click into the reply below and start writing. Try selecting a few words to format them, or type `- ` and a space to start a list.

<EditorDemo scenario="comment" json />

The bar holds bold, italic, link, a bulleted list, a quote, mentions and attachments, the controls people use most. Every other enabled control goes under **More**, along with Undo, Redo and **Formatting help**, which lists the keyboard shortcuts and Markdown shortcuts. Each tool's tooltip shows its shortcut too.

Open **What gets saved** to see the document Editor submits. It's structured JSON rather than HTML, so the server can check it against the same feature set and render it safely. See [Save a Document](../developers/craft-integration.md#save-a-document).

## Choose Features and Toolbar Order

A forum topic needs more structure, so this one turns on headings and numbered lists. Headings sit under **More**, which keeps the bar nearly as short as the reply's.

<EditorDemo scenario="forum" />

The features come from the context's [feature settings](../developers/context-settings.md#features). The order of the bar comes from the browser's [`toolbar` option](../reference/editor-options.md#toolbar), which this demo sets alongside the server's options:

```js
toolbar: ['bold', 'italic', 'link', 'bulletList', 'orderedList', 'blockquote', 'mention', 'attach'],
```

Anything enabled that isn't listed goes under **More**. Set `toolbar: false` to leave the toolbar out altogether, which suits a context with no formatting features turned on. Content pasted from elsewhere is fitted to what's enabled, so a heading level you don't allow becomes the nearest one you do, and formatting you haven't enabled is dropped.

The toolbar sits under the text by default. Set [`toolbarPosition`](../reference/editor-options.md#toolbarposition) to `top` to put it above the text instead, as many document and forum editors do:

<EditorDemo scenario="forumTop" />

```js
toolbarPosition: 'top',
```

Either way, the toolbar stays with the text. When your form adds its own fields around the editor, the text and its toolbar are outlined together, as [Your Own Fields and the Toolbar](looks-layout.md#your-own-fields-and-the-toolbar) shows.

## Selecting Text

Selecting words shows the enabled text styles above them (bold, italic, strikethrough and inline code) plus Link, so a short bar doesn't slow anyone down. Touch screens keep their own selection menus instead.

## Markdown Shortcuts

People who write in Markdown can keep doing so. Typing `- ` starts a bulleted list, `1. ` a numbered one, `> ` a quote and `## ` a heading. `**bold**`, `_italic_`, `~~strike~~` and `` `code` `` format as you type. Only shortcuts for enabled features do anything, and **Formatting help** lists the ones that apply.
