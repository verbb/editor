<?php

declare(strict_types=1);

function fixtureDocument(string $name): array
{
    $path = dirname(__DIR__) . '/fixtures/documents/' . $name . '.json';
    $json = file_get_contents($path);

    if ($json === false) {
        throw new RuntimeException("Missing fixture: {$name}");
    }

    $decoded = json_decode($json, true);

    if (!is_array($decoded)) {
        throw new RuntimeException("Invalid fixture JSON: {$name}");
    }

    return $decoded;
}
