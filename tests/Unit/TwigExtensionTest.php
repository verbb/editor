<?php

declare(strict_types=1);

use verbb\editor\web\twig\Extension;

it('keeps unsafe text escaped through the html-safe twig filter', function () {
    $content = [[
        'type' => 'paragraph',
        'content' => [['type' => 'text', 'text' => '<img src=x onerror=alert(1)>']],
    ]];

    $html = (new Extension())->editorHtml($content, null);

    expect($html)->toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect($html)->not->toContain('<img');
});
