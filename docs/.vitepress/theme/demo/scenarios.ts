import type { EditorContent, EditorOptions } from '@verbb/editor';

/**
 * The editors the docs demos show, modelled on how each host uses Editor. Attributes are the
 * `<verbb-editor>` attributes a Twig template would write; options are what `browserOptions()`
 * would send, minus the `craft` block the demo fills in.
 */
export interface Scenario {
    label: string;
    note: string;
    attrs: Record<string, string | true>;
    options: EditorOptions;
    content?: EditorContent;
    header?: string;
    /** The host's own fields before the text, in `slot="above"`. */
    above?: string;
    /** The host's own fields after the text, in `slot="footer"`. */
    footer?: string;
    cancel?: boolean;
    setup?: (element: HTMLElement) => void;
}

const everything = { mention: true, craftLink: true, image: true, attachment: true };

// A review form's own fields: a rating before the text, as review forms ask for it first, and two after.
const rating = `<fieldset class="editor-demo__rating"><legend>Rating</legend>${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}"><span aria-hidden="true">★</span><span class="editor-demo__sr">${n} ${n === 1 ? 'star' : 'stars'}</span></label>`).join('')}</fieldset>`;
const reviewFields = `<div class="editor-demo__fields"><label>Where did you run it?<input type="text" name="where" placeholder="Wellington"></label><label>Order number<input type="text" name="order" placeholder="Only our team sees this"></label></div>`;

const paragraph = (...content: Record<string, unknown>[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: Record<string, unknown>[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });

export const SCENARIOS: Record<string, Scenario> = {
    comment: {
        label: 'Standard',
        note: 'The standard toolbar with mentions, page links, photos and files. The header says who it’s replying to, with a button to cancel, and there’s a 2,000-character limit and a saved draft.',
        attrs: {
            'aria-label': 'Reply to Alex Morgan',
            placeholder: 'Reply to Alex…',
            'submit-label': 'Reply',
            limit: '2000',
            'draft-key': 'docs:comment',
            'reply-to': 'Alex Morgan',
        },
        options: { preset: 'standard', features: everything },
        setup(element) {
            // What a host does when the reply is cancelled: it becomes a top-level comment.
            element.addEventListener('editor-reply-cancel', () => {
                element.setAttribute('placeholder', 'Add a comment…');
                element.setAttribute('aria-label', 'Add a comment');
            });
        },
        header: '<span class="editor-demo__as">Posting as <b>Jordan Lee</b></span>',
        cancel: true,
    },
    forum: {
        label: 'Full',
        note: 'The full preset for longer writing: headings, numbered lists and quotes, with headings under More so the bar stays short, and a 20,000-character limit.',
        attrs: {
            'aria-label': 'Topic',
            placeholder: 'Share the details: what you tried and what you need…',
            'submit-label': 'Publish topic',
            limit: '20000',
            'draft-key': 'docs:forum',
        },
        options: {
            preset: 'full',
            features: everything,
            toolbar: ['bold', 'italic', 'link', 'bulletList', 'orderedList', 'blockquote', 'mention', 'attach'],
        },
        cancel: true,
    },
    message: {
        label: 'Compact',
        note: 'A short bar and no mentions. Enter sends and Shift+Enter starts a new line, with a 1,000-character limit.',
        attrs: {
            'aria-label': 'Message the group',
            placeholder: 'Message the group…',
            'submit-label': 'Send',
            limit: '1000',
            'enter-submits': true,
        },
        options: {
            preset: 'standard',
            features: { craftLink: true, image: true, attachment: true },
            toolbar: ['attach', 'bold', 'italic', 'link'],
        },
    },
    support: {
        label: 'Modes',
        note: 'The header switches between two modes, Reply and Internal note. The host changes the surface, placeholder and button for each, so a note can’t be mistaken for a reply.',
        attrs: {
            'aria-label': 'Reply to Dana',
            placeholder: 'Reply to Dana…',
            'submit-label': 'Send reply',
        },
        options: { preset: 'standard', features: everything },
        header: `<span class="editor-demo__tabs" role="group" aria-label="Reply type">
            <button type="button" aria-pressed="true" data-mode="reply">Reply</button>
            <button type="button" aria-pressed="false" data-mode="note">Internal note</button>
        </span>`,
        setup(element) {
            element.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
                button.addEventListener('click', () => {
                    const note = button.dataset.mode === 'note';

                    element.querySelectorAll('[data-mode]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
                    element.classList.toggle('is-note', note);
                    element.setAttribute('submit-label', note ? 'Add note' : 'Send reply');
                    element.setAttribute('placeholder', note ? 'Only your team sees this…' : 'Reply to Dana…');
                });
            });
        },
    },
    linked: {
        label: 'Comment',
        note: 'A reply that already has a link in it.',
        attrs: { 'aria-label': 'Reply', 'submit-label': 'Reply' },
        options: { preset: 'standard', features: everything },
        content: [
            paragraph(
                text('If your knees complain on the way down, start with '),
                text('the Ridge Loop', [{ type: 'link', attrs: { href: 'https://example.com/routes/ridge-loop' } }]),
                text('. It climbs steadily and comes back on a gentle fire road.'),
            ),
        ],
    },
    nearLimit: {
        label: 'Comment',
        note: 'A 280-character limit, with a reply that is nearly there.',
        attrs: { 'aria-label': 'Reply', 'submit-label': 'Reply', limit: '280' },
        options: { preset: 'standard' },
        content: [
            paragraph(text('Thanks for the route notes. I ran the Ridge Loop on Saturday and the descent was much kinder than the old track. The only tricky part was the gravel after the second gate, so take it slowly there if it has been dry. I’d happily do it again next weekend')),
        ],
    },
    review: {
        label: 'Review',
        note: 'A review form with the host’s own fields: a rating above the text, and two more after it. The toolbar stays with the text, outlined with it, and Post gets its own row.',
        attrs: { 'aria-label': 'Your review', placeholder: 'What did you think?', 'submit-label': 'Post review' },
        options: { preset: 'standard', features: everything },
        header: '<span class="editor-demo__as">Posting as <b>Jordan Lee</b></span>',
        above: rating,
        footer: reviewFields,
        cancel: true,
    },
    collapsed: {
        label: 'Comment',
        note: 'At the top of a thread the editor is one line until someone starts writing.',
        attrs: { 'aria-label': 'Add a comment', placeholder: 'Add a comment…', 'submit-label': 'Comment', collapsible: true },
        options: { preset: 'standard', features: everything },
    },
};

// The forum topic again, with its toolbar above the text.
SCENARIOS.forumTop = {
    ...SCENARIOS.forum!,
    label: 'Full, toolbar on top',
    note: 'The full preset with `toolbarPosition: \'top\'`.',
    attrs: { ...SCENARIOS.forum!.attrs, 'draft-key': 'docs:forum-top' },
    options: { ...SCENARIOS.forum!.options, toolbarPosition: 'top' },
};

export const PLAYGROUND_SCENARIOS = ['comment', 'forum', 'message', 'support'] as const;
