// jsdom has no layout, so it leaves out the Range measurements ProseMirror uses to scroll the
// selection into view. Browsers have them. Empty measurements let those calls run.
const emptyRect = (): DOMRect => new DOMRect(0, 0, 0, 0);

if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects ??= function getClientRects(): DOMRectList {
        return Object.assign([], { item: () => null }) as unknown as DOMRectList;
    };

    Range.prototype.getBoundingClientRect ??= emptyRect;
}
