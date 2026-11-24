<?php

require_once __DIR__ . '/../Support/Fixtures.php';

use verbb\editor\helpers\References;

it('extracts mention references from a document fixture', function() {
    $references = References::from(fixtureDocument('mention'))->mentions();

    expect($references)->toHaveCount(1);
    expect($references[0]->nodeType)->toBe('mention');
    expect($references[0]->referenceId())->toBe('1');
    expect($references[0]->attrs['label'] ?? null)->toBe('Ash');
});

it('deduplicates repeated mention references in one document', function() {
    $content = [
        [
            'type' => 'paragraph',
            'content' => [
                [
                    'type' => 'mention',
                    'attrs' => ['id' => 5, 'type' => 'craft\\elements\\User', 'label' => 'Pat'],
                ],
                [
                    'type' => 'mention',
                    'attrs' => ['id' => 5, 'type' => 'craft\\elements\\User', 'label' => 'Pat'],
                ],
            ],
        ],
    ];

    expect(References::from($content)->mentions())->toHaveCount(1);
});

it('returns no references for plain rich text', function() {
    expect(References::from(fixtureDocument('basic-rich-text'))->all())->toBe([]);
});

it('extracts craft links from text marks', function() {
    $references = References::from([[
        'type' => 'paragraph',
        'content' => [[
            'type' => 'text',
            'text' => 'Entry',
            'marks' => [['type' => 'craftLink', 'attrs' => ['id' => 7, 'type' => 'craft\\elements\\Entry', 'label' => 'Entry']]],
        ]],
    ]]);

    expect($references->ofType('craftLink'))->toHaveCount(1);
    expect($references->all()[0]->referenceId())->toBe('7');
    expect($references->all()[0]->referenceType())->toBe('craft\\elements\\Entry');
});
