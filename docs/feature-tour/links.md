# Links

One **Link** control handles both kinds of link, an address from anywhere or a page on your own site. Press <kbd>⌘K</kbd> (<kbd>Ctrl+K</kbd> on Windows) or use the Link tool.

## Linking to a Page

Select a few words below, press <kbd>⌘K</kbd>, and type part of a page title, such as "trail". Suggestions appear before you type anything, and each result shows the page's section underneath.

<EditorDemo scenario="comment" />

A chosen page is saved as a reference (its ID, type and label) rather than a fixed address, so the link keeps working if the page moves or is renamed. Page search appears only where the context turns on [Craft links](../developers/craft-integration.md#craft-links) and the visitor is signed in. Everywhere else the same control takes an address.

The line under each page comes from [`ElementLinkConfig::$describe`](../developers/context-settings.md#element-link-config). By default it's the entry's section, the category's group or the element type.

## Pasting an Address

Paste or type any address into the same box. `example.com` gets `https://` added, and `someone@example.com` becomes a `mailto:` link. Other schemes, such as `javascript:`, are refused. It's the same rule the server applies when it saves, so a link that looks fine while writing never quietly disappears on save.

## Edit or Remove a Link

Put the cursor inside the link below. A small card shows where it goes, with buttons to edit or remove it.

<EditorDemo scenario="linked" />
