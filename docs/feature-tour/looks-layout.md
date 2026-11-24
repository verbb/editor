# Looks & Layout

The editor fits into your site rather than bringing a look of its own. Choose a theme, map your colours onto it once, and it adapts to whatever space it's given.

## Themes

Editor has four themes. `light`, the default, suits light pages. `dark` has no background of its own, so it sits on your page's dark surface and matches whatever colour that is.

<EditorDemo scenario="comment" dark />

`craft` takes its colours from the control panel, and `browserOptions()` sends it automatically on control panel requests. `none` keeps the layout and leaves the appearance to your stylesheet. [Themes](../developers/browser-authoring.md#themes) lists every colour token you can set.

## Your Own Colours

Map your design tokens onto Editor's once, on `<verbb-editor>` or any element around it:

```css
.comments verbb-editor {
    --verbb-editor-accent: var(--comments-accent);
    --verbb-editor-bg: var(--comments-surface);
    --verbb-editor-radius: var(--comments-radius);
}
```

The [Playground](playground.md) lets you try different accents and corner radii.

## Switch Styles for an Internal Note

A help desk might offer both a reply to the customer and an internal note. The header slot holds the two tabs, and choosing **Internal note** turns the editor yellow by setting its tokens, so nobody sends a note to a customer by mistake.

<EditorDemo scenario="support" />

```css
verbb-editor.is-note {
    --verbb-editor-bg: #fff8db;
    --verbb-editor-border: #f0d77a;
}
```

The tabs are the host's own markup in `slot="header"`. Editor moves them into the frame and leaves them alone. Your own script listens for clicks on the tabs, toggles the class and changes `submit-label` and `placeholder` to match:

```js
const element = document.querySelector('verbb-editor');

element.querySelectorAll('[data-mode]').forEach((tab) => {
    tab.addEventListener('click', () => {
        const isNote = tab.dataset.mode === 'note';

        element.classList.toggle('is-note', isNote);
        element.setAttribute('submit-label', isNote ? 'Add note' : 'Send reply');
        element.setAttribute('placeholder', isNote ? 'Only your team sees this…' : 'Reply to Dana…');
    });
});
```

Changing an attribute updates the editor in place, so whatever has been written stays put when someone switches tabs.

## Your Own Fields and the Toolbar

A form often asks for more than the text, such as a rating or an order number. Put your own fields in the editor's `above` and `footer` slots, and Editor places them around the text. Once there are fields, the text and its toolbar are outlined together, and Post moves to a row of its own, so the toolbar reads as the text's and not the whole form's. Without fields, the toolbar stays beside Post.

<EditorDemo scenario="review" />

```html
<verbb-editor name="review" submit-label="Post review" placeholder="What did you think?">
    <div slot="above">
        <!-- Your rating, which review forms ask for first -->
    </div>
    <div slot="footer">
        <!-- Your other fields -->
    </div>
</verbb-editor>
```

The fields are your own markup, inside the same form, so they're submitted with the post. Editor moves them into its frame and leaves them alone.

The toolbar can also sit above the text, as [Choose Features and Toolbar Order](writing-formatting.md#choose-features-and-toolbar-order) shows. The [slots](../reference/editor-options.md#element-attributes) are in the reference.

## Collapsed and Borderless Editors

At the top of a thread, `collapsible` keeps the editor to one line until someone clicks into it. If they leave without writing anything, it closes again.

<EditorDemo scenario="collapsed" />

Use `bare` when your page already draws the card around the editor. It removes the editor's own border and background.

## Narrow Spaces

The editor responds to its own width, not the screen's, so it works the same in a sidebar as on a phone. Under 520 pixels the tools scroll sideways in one row, and under 400 pixels the Post button becomes an arrow.

<EditorDemo scenario="comment" width="360" />
