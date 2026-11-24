# Mentions

Type <kbd>@</kbd> to mention someone. Suggestions show each person's photo or initials, their name, and a line about them, such as "Author" or "Commented 3 h ago".

## Suggesting People

Type <kbd>@</kbd> in the reply below. This thread knows who's taking part, so those people appear straight away, before you type a name, then narrow as you type. Choose with the pointer, or use the arrow keys and <kbd>Enter</kbd>. <kbd>Esc</kbd> closes the list and stops searching until you start a new mention.

<EditorDemo scenario="comment" json />

A mention is saved as a reference to the user, their ID alongside the name shown, so your plugin can notify them when it saves the post and link to their current profile when it renders it. Open **What gets saved** after choosing someone to see it.

Who can be mentioned is decided on the server by the context's [mention settings](../developers/craft-integration.md#mentions). Suggestions before anything is typed come from the default provider only when the context names who's eligible with [`eligibleIds`](../developers/context-settings.md#eligibleids), such as the people already in a thread. Without it, suggestions start once someone has typed two letters. The line under each name comes from [`MentionConfig::$describe`](../developers/context-settings.md#mention-config), and a photo appears when the user's photo volume has public URLs.

## When People Can't Be Loaded

This reply's people search is set to fail. Type <kbd>@</kbd> to see what happens.

<EditorDemo scenario="comment" mention-fail />

The list says so in plain words and offers **Try again**. Writing carries on, and a name typed after the `@` is posted as ordinary text. The technical detail goes to the browser console for you, and the person writing only sees the plain message.
