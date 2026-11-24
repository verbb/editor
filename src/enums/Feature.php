<?php
namespace verbb\editor\enums;

enum Feature: string
{
    case Bold = 'bold';
    case Italic = 'italic';
    case Strike = 'strike';
    case Underline = 'underline';
    case Code = 'code';
    case Headings = 'headings';
    case Lists = 'lists';
    case Blockquote = 'blockquote';
    case Link = 'link';
    case CraftLink = 'craftLink';
    case Image = 'image';
    case Attachment = 'attachment';
    case Mention = 'mention';
}
