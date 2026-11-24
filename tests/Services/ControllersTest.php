<?php

declare(strict_types=1);

use Tests\Support\Factory;
use Tests\Support\HttpSession;

use craft\elements\Asset;
use craft\elements\User;

const MENTIONS = '/actions/verbb-editor/mentions/search';
const ELEMENTS = '/actions/verbb-editor/elements/search';
const UPLOAD = '/actions/verbb-editor/assets/upload';

function member(array $attributes = ['fullName' => 'Http Member']): array
{
    Factory::volume();
    $user = Factory::user($attributes);
    $session = new HttpSession();
    $session->login($user->username);

    return [$session, $user];
}

it('refuses anonymous requests to every action', function (string $path) {
    $session = new HttpSession();
    $session->refreshCsrf();
    $response = $session->post($path, ['context' => 'http.open', 'query' => 'pat']);

    expect($response['status'])->toBe(403);
})->with([MENTIONS, ELEMENTS, UPLOAD]);

it('refuses a guest holding a valid site token', function (string $path) {
    $token = Craft::$app->getSecurity()->hashData((string)Craft::$app->getSites()->getPrimarySite()->id);
    $session = new HttpSession();
    $session->refreshCsrf();
    $param = Craft::$app->getConfig()->getGeneral()->siteToken;

    expect($session->post($path . '?' . $param . '=' . urlencode($token), ['context' => 'http.open', 'query' => 'pat'])['status'])->toBe(403);
})->with([MENTIONS, ELEMENTS, UPLOAD]);

it('requires a CSRF token', function (string $path) {
    [$session] = member();

    expect($session->post($path, ['context' => 'http.open', 'query' => 'pat'], withCsrf: false)['status'])->toBe(400);
})->with([MENTIONS, ELEMENTS, UPLOAD]);

it('requires a JSON request by POST', function () {
    [$session] = member();

    expect($session->request('GET', MENTIONS . '?context=http.open')['status'])->toBe(405);
    expect($session->request('POST', MENTIONS, 'context=http.open', ['Accept: text/html', 'X-CSRF-Token: ' . $session->csrfToken])['status'])->toBe(400);
});

it('returns search results in Craft’s envelope', function () {
    [$session, $user] = member(['fullName' => 'Http Findable']);
    $response = $session->post(MENTIONS, ['context' => 'http.open', 'query' => 'Http Find']);

    expect($response['status'])->toBe(200);
    expect($response['json'])->toBe(['results' => [['id' => (int)$user->id, 'type' => User::class, 'label' => 'Http Findable']]]);
});

it('answers an unknown context with 404 and no detail', function () {
    [$session] = member();
    $response = $session->post(MENTIONS, ['context' => 'http.missing', 'query' => 'pat']);

    expect($response['status'])->toBe(404);
    expect($response['json']['message'])->toBe('This editor is no longer available.');
    expect($response['body'])->not->toContain('http.missing');
});

it('checks the authorize hook before any work', function (string $path) {
    [$session] = member();
    $response = $session->post($path, ['context' => 'http.denied', 'query' => 'pat']);

    expect($response['status'])->toBe(403);
    expect($response['json']['message'])->toBe('You can’t use this editor here.');
})->with([MENTIONS, ELEMENTS, UPLOAD]);

it('passes the capability to the authorize hook', function () {
    [$session] = member();

    expect($session->post(MENTIONS, ['context' => 'http.capability', 'query' => 'pat'])['status'])->toBe(200);
    expect($session->post(ELEMENTS, ['context' => 'http.capability', 'query' => 'pat'])['status'])->toBe(403);
    expect($session->upload(UPLOAD, ['context' => 'http.capability'], 'file', 'a.txt', 'plain text contents')['status'])->toBe(403);
});

it('reports a disabled capability as a request fault with its message', function () {
    [$session] = member();
    $response = $session->post(MENTIONS, ['context' => 'http.off', 'query' => 'pat']);

    expect($response['status'])->toBe(400);
    expect($response['json']['message'])->toBe('Mentions are disabled for this editor context.');
    expect($session->post(ELEMENTS, ['context' => 'http.open', 'query' => 'pat'])['json']['message'])->toBe('Craft element links are disabled for this editor context.');
});

it('reports internal failures as 500 without their detail', function () {
    [$session] = member();
    $response = $session->post(MENTIONS, ['context' => 'http.broken', 'query' => 'pat']);

    expect($response['status'])->toBe(500);
    expect($response['json']['message'])->toBe('The Editor resource request could not be processed.');
    expect($response['body'])->not->toContain('Secret');
});

it('refuses an overlong query', function () {
    [$session] = member();
    $response = $session->post(MENTIONS, ['context' => 'http.open', 'query' => str_repeat('a', 201)]);

    expect($response['status'])->toBe(400);
    expect($response['json']['message'])->toBe('The search is too long.');
});

it('treats non-string params as request faults', function () {
    [$session] = member();

    expect($session->post(MENTIONS, ['context' => ['http.open'], 'query' => 'pat'])['status'])->toBe(404);
    expect($session->post(MENTIONS, ['context' => 'http.open', 'query' => ['pat']])['status'])->toBe(400);
    expect($session->upload(UPLOAD, ['context' => 'http.open', 'kind[]' => 'x'], 'file', 'a.txt', 'plain text contents')['status'])->toBe(400);
});

it('validates client scope through the context', function () {
    [$session, $user] = member(['fullName' => 'Scope Person']);

    $allowed = $session->post(MENTIONS, ['context' => 'http.scoped', 'query' => 'Scope', 'scope' => ['ownerId' => 7, 'admin' => true]]);

    expect($allowed['status'])->toBe(200);
    expect(array_column($allowed['json']['results'], 'id'))->toContain((int)$user->id);
    // Providers see only what the callable returned, not the client's other values.
    expect(json_decode($session->header('X-Reference-Context'), true))->toBe(['ownerId' => 7, 'by' => (int)$user->id]);

    expect($session->post(MENTIONS, ['context' => 'http.scoped', 'query' => 'Scope', 'scope' => ['ownerId' => 8]])['status'])->toBe(403);
    expect($session->post(MENTIONS, ['context' => 'http.scoped', 'query' => 'Scope'])['status'])->toBe(403);
    expect($session->post(MENTIONS, ['context' => 'http.scoped', 'query' => 'Scope', 'scope' => 'not json'])['status'])->toBe(400);
    expect($session->post(MENTIONS, ['context' => 'http.scoped', 'query' => 'Scope', 'scope' => ['x' => str_repeat('a', 5000)]])['status'])->toBe(400);
});

it('never copies client scope into a context without a resolver', function () {
    [$session] = member();
    $response = $session->post(MENTIONS, ['context' => 'http.open', 'query' => 'pat', 'scope' => ['ownerId' => 7]]);

    expect($response['status'])->toBe(200);
    expect($session->header('X-Reference-Context'))->toBeNull();
});

it('uploads through the real endpoint', function () {
    [$session, $user] = member();
    $response = $session->upload(UPLOAD, ['context' => 'http.open', 'kind' => 'inlineImage'], 'file', 'photo.png', Factory::pngBytes());

    expect($response['status'])->toBe(200);
    expect($response['json']['asset'])->toMatchArray(['filename' => 'photo.png', 'kind' => 'inlineImage', 'temporary' => true]);

    $asset = Asset::find()->id($response['json']['asset']['id'])->status(null)->one();

    expect((int)$asset->uploaderId)->toBe((int)$user->id);
    expect($asset->volumeId)->toBeNull();
});

it('sends scope through uploads as a JSON field', function () {
    [$session] = member();

    expect($session->upload(UPLOAD, ['context' => 'http.scoped', 'kind' => 'attachment', 'scope' => '{"ownerId":7}'], 'file', 'a.txt', 'plain text contents')['status'])->toBe(200);
    expect($session->upload(UPLOAD, ['context' => 'http.scoped', 'kind' => 'attachment', 'scope' => '{"ownerId":8}'], 'file', 'a.txt', 'plain text contents')['status'])->toBe(403);
    expect($session->upload(UPLOAD, ['context' => 'http.scoped', 'kind' => 'attachment', 'scope' => '{broken'], 'file', 'a.txt', 'plain text contents')['status'])->toBe(400);
});

it('passes upload refusal messages through to the author', function (string $context, string $name, string $kind, string $message) {
    [$session] = member();
    $response = $session->upload(UPLOAD, ['context' => $context, 'kind' => $kind], 'file', $name, $name === 'photo.png' ? Factory::pngBytes() : 'text');

    expect($response['status'])->toBe(400);
    expect($response['json']['message'])->toBe($message);
})->with([
    ['http.open', 'bad.exe', 'attachment', 'File type is not permitted.'],
    ['http.small', 'photo.png', 'inlineImage', 'File exceeds the maximum allowed size.'],
    ['http.open', 'fake.png', 'inlineImage', 'The uploaded file content does not match its extension.'],
    ['http.off', 'photo.png', 'inlineImage', 'This type of upload is disabled for this editor context.'],
]);

it('refuses a missing file and an unknown kind', function () {
    [$session] = member();

    expect($session->post(UPLOAD, ['context' => 'http.open'])['json']['message'])->toBe('No file was uploaded.');
    expect($session->upload(UPLOAD, ['context' => 'http.open', 'kind' => 'video'], 'file', 'a.txt', 'plain text contents')['json']['message'])->toBe('Unsupported upload kind.');
});

it('gives the browser everything it needs to reach the endpoints', function () {
    [$session] = member();
    $options = $session->request('GET', '/__options?context=http.open&scope=' . urlencode('{"ownerId":7}'))['json'];

    expect($options['features'])->toMatchArray(['bold' => true, 'mention' => true, 'image' => true, 'attachment' => true, 'craftLink' => false, 'headings' => false]);
    expect($options['craft']['context'])->toBe('http.open');
    expect($options['craft']['scope'])->toBe(['ownerId' => 7]);
    expect(array_keys($options['craft']['endpoints']))->toBe(['upload', 'mentions']);
    expect($options['craft']['csrfTokenName'])->toBe(Craft::$app->getConfig()->getGeneral()->csrfTokenName);
    expect($options['craft']['csrfToken'])->toBeString()->not->toBe('');
    expect($options['craft']['uploads'])->toMatchArray(['imageExtensions' => ['png', 'txt'], 'attachmentExtensions' => ['png', 'txt'], 'maxFileSize' => 1048576]);
    expect($options['labels'])->toHaveKey('bold');

    // The URLs the server hands out really reach the actions with the token it hands out.
    $parts = parse_url($options['craft']['endpoints']['mentions']);
    $response = $session->request('POST', $parts['path'] . (isset($parts['query']) ? '?' . $parts['query'] : ''), json_encode(['context' => 'http.open', 'query' => 'pat']), [
        'Content-Type: application/json',
        'X-CSRF-Token: ' . $options['craft']['csrfToken'],
    ]);

    expect($response['status'])->toBe(200);
    expect($response['json'])->toHaveKey('results');
});

it('gives guests no endpoints or token', function () {
    $session = new HttpSession();
    $options = $session->request('GET', '/__options?context=http.open')['json'];

    expect($options['craft'])->toBeFalse();
    expect($options['features'])->toMatchArray(['bold' => true, 'mention' => false, 'image' => false, 'attachment' => false]);
});
