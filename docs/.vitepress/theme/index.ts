import type { Theme } from 'vitepress';
import { createVerbbDocsTheme } from '@verbb/vitepress-theme';

import EditorDemo from './demo/EditorDemo.vue';
import EditorPlayground from './demo/EditorPlayground.vue';
import './demo/demo.css';
import './reference.css';

const theme: Theme = createVerbbDocsTheme({
    enhanceApp({ app }) {
        app.component('EditorDemo', EditorDemo);
        app.component('EditorPlayground', EditorPlayground);
    },
});

export default theme;
