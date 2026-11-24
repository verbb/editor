import Link from '@tiptap/extension-link';

import { safeUrl } from '../core/urls';

/** Ordinary links. Its own feature because Tiptap's link brings linkify, the largest optional part. */
export function createLinkExtension(craftLink: boolean) {
    return Link.extend({ excludes: craftLink ? 'link craftLink' : 'link' }).configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url) => !!safeUrl(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    });
}
