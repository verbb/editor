<?php
namespace verbb\editor\helpers;

use Craft;

/**
 * The browser's interface strings, passed through Craft's translations by
 * `EditorConfig::browserOptions()`. The keys and English text mirror the browser package's
 * `config/labels.ts`, and `{name}`-style placeholders are filled in by the browser.
 */
class Labels
{
    // Constants
    // =========================================================================

    public const DEFAULTS = [
        'editor' => 'Rich text editor',
        'toolbar' => 'Formatting',
        'formatSelection' => 'Format selection',
        'more' => 'More formatting',
        'bold' => 'Bold',
        'italic' => 'Italic',
        'strike' => 'Strikethrough',
        'underline' => 'Underline',
        'code' => 'Inline code',
        'heading' => 'Heading {level}',
        'bulletList' => 'Bulleted list',
        'orderedList' => 'Numbered list',
        'blockquote' => 'Quote',
        'link' => 'Link',
        'mention' => 'Mention someone',
        'attach' => 'Attach files',
        'addPhotos' => 'Add photos',
        'gif' => 'GIF',
        'gifAdd' => 'Add a GIF',
        'gifSearch' => 'Search GIPHY',
        'gifResults' => 'GIFs',
        'gifEmpty' => 'No GIFs found.',
        'gifUnavailable' => 'GIFs can’t be loaded right now.',
        'gifPoweredBy' => 'Powered by GIPHY',
        'gifRemove' => 'Remove GIF',
        'undo' => 'Undo',
        'redo' => 'Redo',
        'formattingHelp' => 'Formatting help',
        'shortcuts' => 'Shortcuts',
        'markdown' => 'Markdown works too',
        'newLine' => 'New line',
        'either' => '{first} or {second}',
        'linkPrompt' => 'Paste a link or search pages',
        'linkPromptAddress' => 'Paste or type a link',
        'linkAddress' => 'Link address or page',
        'linkTo' => 'Link to {address}',
        'webAddress' => 'Web address',
        'suggestedPages' => 'Suggested pages',
        'pages' => 'Pages on this site',
        'noPages' => 'No pages match “{query}”',
        'noPagesHint' => 'Paste a full address to link anywhere else.',
        'pageLinksKeep' => 'Page links keep working if the page moves.',
        'pagesFailed' => 'Couldn’t load pages. You can still paste an address.',
        'enterToAdd' => '↵ to add',
        'invalidUrl' => 'Enter a valid URL, email address or relative link.',
        'openLink' => 'Open link',
        'editLink' => 'Edit link',
        'removeLink' => 'Remove link',
        'searching' => 'Searching…',
        'mentionSuggestions' => 'Mention suggestions',
        'mentionPeople' => 'People',
        'mentionIdle' => 'Suggested people',
        'mentionHint' => 'Keep typing to search.',
        'mentionNone' => 'No one called “{query}”',
        'mentionPlain' => 'It’ll post as plain text.',
        'mentionFailed' => 'Couldn’t load people',
        'mentionFailedHint' => 'Keep typing and it’ll post as plain text.',
        'mentionKeys' => '↑↓ to choose · ↵ to mention',
        'tryAgain' => 'Try again',
        'uploads' => 'Uploads',
        'uploadingFile' => 'Uploading {name}, {percent}%',
        'uploadingStatus' => 'Uploading…',
        'uploaded' => '{name} uploaded.',
        'uploadFailedShort' => 'Didn’t upload',
        'uploadFailed' => '{name} didn’t upload. {reason}',
        'retry' => 'Retry',
        'retryUpload' => 'Retry upload of {name}',
        'remove' => 'Remove {name}',
        'uploadPending' => 'Please wait for your uploads to finish.',
        'uploadsFailed' => 'Retry or remove the upload that didn’t finish.',
        'unsupportedFile' => '{name} can’t be added here.',
        'fileTooLarge' => '{name} is larger than the upload limit.',
        'tooManyImages' => '{count, plural, one{You can add up to # photo.} other{You can add up to # photos.}}',
        'tooManyFiles' => '{count, plural, one{You can add up to # file.} other{You can add up to # files.}}',
        'dropToAttach' => 'Drop to attach',
        'altText' => 'Alt text',
        'addAlt' => 'Add alt text for {name}',
        'editAlt' => 'Edit alt text for {name}',
        'altPrompt' => 'What’s in the photo?',
        'altHint' => 'Describes the photo for people using screen readers. One sentence is plenty.',
        'save' => 'Save',
        'cancel' => 'Cancel',
        'dismiss' => 'Dismiss',
        'uploadedImage' => 'Uploaded image',
        'attachment' => 'Attachment',
        'required' => 'Please enter some text.',
        'replyingTo' => 'Replying to {name}',
        'cancelReply' => 'Cancel reply',
        'submit' => 'Post',
        'posting' => 'Posting…',
        'writeFirst' => 'Write something first.',
        'draftSaved' => 'Draft saved',
        'draftRestored' => 'Restored your draft from {time}.',
        'draftFilesDropped' => 'Files older than a day were removed.',
        'discard' => 'Discard',
        'tooLong' => '{count, plural, one{Too long by # character} other{Too long by # characters}}',
        'charactersLeft' => '{count, plural, one{# character left} other{# characters left}}',
        'charactersOf' => '{count} of {limit} characters',
        'postFailed' => 'Couldn’t post. Check your connection and try again. Your text is still here.',
        'connectionFailed' => 'Unable to connect. Please try again.',
        'accessDenied' => 'Sign in again or check your access to this resource.',
        'tooManyRequests' => 'Too many requests. Please wait and try again.',
        'somethingWrong' => 'Something went wrong. Please try again.',
    ];


    // Static Methods
    // =========================================================================

    public static function all(): array
    {
        return array_map(static fn(string $label): string => Craft::t('editor', $label), self::DEFAULTS);
    }
}
