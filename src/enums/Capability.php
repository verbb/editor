<?php
namespace verbb\editor\enums;

enum Capability: string
{
    case Upload = 'upload';
    case Mentions = 'mentions';
    case Elements = 'elements';
}
