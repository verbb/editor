<?php

declare(strict_types=1);

use verbb\editor\helpers\Giphy;

it('accepts GIPHY’s own media addresses as they are, with their size', function () {
    $url = 'https://media2.giphy.com/media/abc/giphy.webp?cid=123&rid=giphy.webp&ct=g';

    expect(Giphy::normalize(['url' => $url, 'width' => '480', 'height' => 360]))->toBe(['url' => $url, 'width' => 480, 'height' => 360]);
    expect(Giphy::normalize(json_encode(['url' => $url])))->toBe(['url' => $url, 'width' => null, 'height' => null]);
    expect(Giphy::normalize(['url' => 'https://i.giphy.com/abc.gif', 'width' => -4, 'height' => 99999]))->toBe(['url' => 'https://i.giphy.com/abc.gif', 'width' => null, 'height' => null]);
});

it('refuses anything that isn’t one of GIPHY’s addresses', function (mixed $gif) {
    expect(Giphy::normalize($gif))->toBeNull();
})->with([
    'no address' => [['width' => 10]],
    'another host' => [['url' => 'https://example.com/giphy.com/a.gif']],
    'a lookalike host' => [['url' => 'https://giphy.com.example.com/a.gif']],
    'plain http' => [['url' => 'http://media.giphy.com/a.gif']],
    'markup' => [['url' => 'https://media.giphy.com/a.gif"><script>']],
    'too long' => [['url' => 'https://media.giphy.com/' . str_repeat('a', 2100)]],
    'not a GIF' => ['https://media.giphy.com/a.gif'],
    'nothing' => [null],
]);
