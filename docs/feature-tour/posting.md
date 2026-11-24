# Posting

The editor has its own Post button, character limit, saved draft and error message, so each plugin doesn't build its own. Your plugin still does the posting. Editor tells it when someone posts, and your code sends the document wherever it goes.

## Posting a Reply

Write something below and post it with the **Reply** button or <kbd>⌘↵</kbd> (<kbd>Ctrl+Enter</kbd> on Windows).

<EditorDemo scenario="comment" draft="posting" />

While your code is posting, the editor is read-only and the button says "Posting…". Afterwards the form resets, which clears the text and the draft. While the editor is empty, over its limit, still uploading or holding a failed upload, posting does nothing and the editor says why instead.

This demo sets the attributes below. In a Twig template, `options` would hold your context's [`browserOptions()`](../developers/craft-integration.md#put-an-editor-on-a-page), and `comment` the comment being replied to.

```twig
<verbb-editor name="comment" required aria-label="Reply to Alex Morgan" reply-to="Alex Morgan"
    submit-label="Reply" limit="2000" draft-key="reply:{{ currentUser.id }}:{{ comment.id }}"
    data-options="{{ options|json_encode }}">
    <span slot="header">Posting as <b>{{ currentUser.friendlyName }}</b></span>
    <button slot="actions" type="reset" class="verbb-editor__button">Cancel</button>
</verbb-editor>
```

`reply-to` shows who the reply is to. Its × cancels the reply and fires `editor-reply-cancel`, so your code can clear the parent it was replying to. Without `submit-label` there's no Post button, and your own buttons go in the `actions` slot. A submit button there goes through the form's own validation, so an over-long reply or one still uploading won't submit, and an empty one won't either as long as the editor has `required`. See [Editor Options](../reference/editor-options.md#element-attributes) for the full list of attributes, slots and events.

## Keeping a Draft

`draft-key` keeps an unfinished reply in the visitor's browser. Write a few words above, then reload this page. The editor brings your text back and says when it was saved, with **Discard** if you'd rather start again.

Include the user and whatever they're replying to in the key, so drafts never cross between replies or people. Drafts are forgotten on a successful post, on reset, on Discard and when your code calls `clearDraft()`. Uploads more than 23 hours old are left out of a restored draft, and the editor says so.

## Character Limits

This reply has a 280-character limit and is nearly full. Keep typing.

<EditorDemo scenario="nearLimit" />

Nothing shows until the text reaches 80% of the limit. Then a ring appears and counts down the last stretch, and past the limit it says how much to cut. Over the limit, Post is held and the field reports "Too long by 12 characters" to validation and screen readers. Your server should still enforce its own limit.

## When Posting Fails

Posting this reply is set to fail. Write something and post it.

<EditorDemo scenario="comment" post-fail />

Nothing is lost. The text stays where it was, and **Try again** posts it again. Your code shows this by calling `showPostError()`, optionally with your own message. The `editor-submit` event carries the document as a JSON string in `event.detail.value`, ready to send:

```js
const element = document.querySelector('verbb-editor');

element.addEventListener('editor-submit', async (event) => {
    event.preventDefault();
    element.setAttribute('busy', '');

    try {
        // Your own request that saves the reply.
        await saveReply(event.detail.value);
        element.form.reset();
    } catch {
        element.showPostError();
    } finally {
        element.removeAttribute('busy');
    }
});
```

## Chat Messages

In a chat, <kbd>Enter</kbd> should send. Add `enter-submits` and <kbd>Shift+Enter</kbd> starts a new line instead. Lists and an open mention list still use <kbd>Enter</kbd> as usual.

<EditorDemo scenario="message" />
