<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import type { DemoSimulation } from './fakeCraft';
import { addSampleFile, type MountedDemo, mountDemo } from './mount';
import { PLAYGROUND_SCENARIOS, SCENARIOS } from './scenarios';

const ACCENTS = [
    { label: 'Blue', value: '#2563eb' },
    { label: 'Teal', value: '#0e7c86' },
    { label: 'Green', value: '#1f7a55' },
    { label: 'Violet', value: '#5b47d6' },
    { label: 'Orange', value: '#d9480f' },
    { label: 'Black', value: '#111111' },
];

const scenarioKey = ref<string>('comment');
const dark = ref(false);
const accent = ref(ACCENTS[0].value);
const radius = ref(10);
const phone = ref(false);
const shortLimit = ref(false);
const posted = ref<{ html: string; uploads: number } | null>(null);
const saved = ref('');
const simulation = reactive<DemoSimulation>({ uploadFail: false, mentionFail: false, postFail: false });

const mountPoint = ref<HTMLElement | null>(null);
const scenario = computed(() => SCENARIOS[scenarioKey.value]);
const stageStyle = computed(() => ({
    // Black can't be an accent on a dark surface, so it flips to near-white, as in the mockup.
    '--verbb-editor-accent': dark.value && accent.value === '#111111' ? '#f1f1f1' : accent.value,
    '--verbb-editor-accent-fg': dark.value && accent.value === '#111111' ? '#111' : '#fff',
    '--verbb-editor-radius': `${radius.value}px`,
    maxWidth: phone.value ? '375px' : undefined,
}));

let demo: MountedDemo | null = null;
let generation = 0;

function limitFor(): string | null {
    if (shortLimit.value) return '280';

    const limit = scenario.value.attrs.limit;

    return typeof limit === 'string' ? limit : null;
}

/** A different feature set is a different editor, so it's mounted afresh. */
async function remount(): Promise<void> {
    const current = ++generation;

    demo?.destroy();
    demo = null;
    posted.value = null;

    if (!mountPoint.value) return;

    const mounted = await mountDemo(mountPoint.value, scenario.value, simulation, {
        onPosted: ({ html, uploads }) => { posted.value = { html, uploads }; },
        onUpdate: (json) => { saved.value = JSON.stringify(json, null, 2); },
    }, { attrs: { theme: dark.value ? 'dark' : 'light', limit: limitFor() } });

    // A quick second switch can finish first; keep only the latest.
    if (current !== generation) {
        mounted.destroy();

        return;
    }

    demo = mounted;
}

onMounted(remount);
onBeforeUnmount(() => demo?.destroy());

watch(scenarioKey, remount);

// Theme and limit are live attributes, so the editor keeps what's been written.
watch(dark, (value) => demo?.element.setAttribute('theme', value ? 'dark' : 'light'));
watch(shortLimit, () => {
    const limit = limitFor();

    if (limit) demo?.element.setAttribute('limit', limit);
    else demo?.element.removeAttribute('limit');
});

const add = (kind: 'photo' | 'file') => {
    if (demo) addSampleFile(demo.element, kind);
};
</script>

<template>
    <div class="editor-playground not-prose">
        <div class="editor-playground__main">
            <div class="editor-demo__stage" :class="{ 'editor-demo--dark': dark }">
                <p class="editor-playground__note">{{ scenario.note }}</p>
                <div ref="mountPoint" class="editor-demo__mount" :style="stageStyle" />
                <div v-if="posted" class="editor-demo__posted" aria-live="polite">
                    <span class="editor-demo__label">Posted</span>
                    <div class="editor-demo__html" v-html="posted.html" />
                    <p v-if="posted.uploads" class="editor-demo__uploads">With {{ posted.uploads }} {{ posted.uploads === 1 ? 'upload' : 'uploads' }}</p>
                </div>
            </div>
            <details class="editor-demo__json">
                <summary>What gets saved</summary>
                <pre>{{ saved }}</pre>
            </details>
        </div>

        <aside class="editor-playground__controls" aria-label="Playground settings">
            <fieldset>
                <legend>Setup</legend>
                <div class="editor-playground__segments">
                    <label v-for="key in PLAYGROUND_SCENARIOS" :key="key">
                        <input v-model="scenarioKey" type="radio" name="editor-playground-scenario" :value="key">
                        <span>{{ SCENARIOS[key].label }}</span>
                    </label>
                </div>
            </fieldset>

            <fieldset>
                <legend>Look</legend>
                <div class="editor-playground__segments">
                    <label><input v-model="dark" type="radio" name="editor-playground-theme" :value="false"><span>Light</span></label>
                    <label><input v-model="dark" type="radio" name="editor-playground-theme" :value="true"><span>Dark</span></label>
                </div>
                <div class="editor-playground__swatches">
                    <label v-for="swatch in ACCENTS" :key="swatch.value" :style="{ '--swatch': swatch.value }">
                        <input v-model="accent" type="radio" name="editor-playground-accent" :value="swatch.value" :aria-label="`${swatch.label} accent`">
                    </label>
                </div>
                <label class="editor-playground__range">
                    <span>Corner radius <output>{{ radius }}px</output></span>
                    <input v-model.number="radius" type="range" min="0" max="20">
                </label>
                <div class="editor-playground__segments">
                    <label><input v-model="phone" type="radio" name="editor-playground-width" :value="false"><span>Page width</span></label>
                    <label><input v-model="phone" type="radio" name="editor-playground-width" :value="true"><span>375 px</span></label>
                </div>
            </fieldset>

            <fieldset>
                <legend>Make things go wrong</legend>
                <label class="editor-playground__toggle"><input v-model="simulation.uploadFail" type="checkbox"> Uploads fail</label>
                <label class="editor-playground__toggle"><input v-model="simulation.mentionFail" type="checkbox"> People search fails</label>
                <label class="editor-playground__toggle"><input v-model="simulation.postFail" type="checkbox"> Posting fails</label>
                <label class="editor-playground__toggle"><input v-model="shortLimit" type="checkbox"> 280-character limit</label>
            </fieldset>

            <fieldset>
                <legend>Add files</legend>
                <div class="editor-demo__tools">
                    <button type="button" class="editor-demo__button" @click="add('photo')">Add a photo</button>
                    <button type="button" class="editor-demo__button" @click="add('file')">Add a file</button>
                </div>
            </fieldset>

            <fieldset>
                <legend>Try it</legend>
                <ul class="editor-playground__try">
                    <li>Select some words to format them</li>
                    <li>Press <kbd>⌘K</kbd> and search for a page</li>
                    <li>Type <kbd>@</kbd> to mention someone</li>
                    <li>Type <kbd>-</kbd> and a space to start a list</li>
                    <li>Drop, paste or attach a file</li>
                    <li>Post with <kbd>⌘↵</kbd></li>
                </ul>
            </fieldset>
        </aside>
    </div>
</template>
