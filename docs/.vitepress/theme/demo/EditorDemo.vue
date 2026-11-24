<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import type { DemoSimulation } from './fakeCraft';
import { addSampleFile, type MountedDemo, mountDemo } from './mount';
import { SCENARIOS } from './scenarios';

const props = withDefaults(defineProps<{
    scenario?: string;
    dark?: boolean;
    /** Show the editor at this width in pixels, such as 375 for a phone. */
    width?: number | string;
    files?: boolean;
    json?: boolean;
    uploadFail?: boolean;
    mentionFail?: boolean;
    postFail?: boolean;
    caption?: string;
    /** Keep a local draft under this name. Off by default, so demos don't restore each other's drafts. */
    draft?: string;
}>(), { scenario: 'comment' });

const mountPoint = ref<HTMLElement | null>(null);
const posted = ref<{ html: string; uploads: number } | null>(null);
const saved = ref('');
const simulation = reactive<DemoSimulation>({
    uploadFail: props.uploadFail,
    mentionFail: props.mentionFail,
    postFail: props.postFail,
});
const stageStyle = computed(() => (props.width ? { maxWidth: `${props.width}px` } : {}));

let demo: MountedDemo | null = null;

onMounted(async () => {
    const scenario = SCENARIOS[props.scenario];

    if (!mountPoint.value || !scenario) return;

    demo = await mountDemo(mountPoint.value, scenario, simulation, {
        onPosted: ({ html, uploads }) => { posted.value = { html, uploads }; },
        onUpdate: (json) => { saved.value = JSON.stringify(json, null, 2); },
    }, {
        attrs: {
            'draft-key': props.draft ? `docs:${props.draft}` : null,
            ...(props.dark ? { theme: 'dark' } : {}),
        },
    });
});

onBeforeUnmount(() => demo?.destroy());

const add = (kind: 'photo' | 'file') => {
    if (demo) addSampleFile(demo.element, kind);
};
</script>

<template>
    <figure class="editor-demo not-prose" :class="{ 'editor-demo--dark': dark }">
        <div class="editor-demo__stage">
            <div ref="mountPoint" class="editor-demo__mount" :style="stageStyle" />
        </div>
        <div v-if="files" class="editor-demo__tools">
            <button type="button" class="editor-demo__button" @click="add('photo')">Add a photo</button>
            <button type="button" class="editor-demo__button" @click="add('file')">Add a file</button>
            <span>or drop your own files on the editor</span>
        </div>
        <div v-if="posted" class="editor-demo__posted" aria-live="polite">
            <span class="editor-demo__label">Posted</span>
            <!-- Editor's own HTML preview of what the visitor just typed here. -->
            <div class="editor-demo__html" v-html="posted.html" />
            <p v-if="posted.uploads" class="editor-demo__uploads">With {{ posted.uploads }} {{ posted.uploads === 1 ? 'upload' : 'uploads' }}</p>
        </div>
        <details v-if="json" class="editor-demo__json">
            <summary>What gets saved</summary>
            <pre>{{ saved }}</pre>
        </details>
        <figcaption v-if="caption">{{ caption }}</figcaption>
    </figure>
</template>
