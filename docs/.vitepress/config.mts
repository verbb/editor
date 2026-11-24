import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitepress';

type SidebarEntry = string | SidebarGroup;

type SidebarGroup = {
    title: string;
    path?: string;
    collapsable?: boolean;
    children: SidebarEntry[];
};

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = path.resolve(docsRoot, '..');
const sidebarConfig = JSON.parse(fs.readFileSync(path.join(docsRoot, '.sidebar.json'), 'utf8')) as SidebarGroup[];

const h1Regex = /^#\s+(.+)$/m;
const zeroWidthRegex = /[\u200B-\u200D\uFEFF]/g;

const getDocPath = (entryPath: string): string => {
    return path.join(docsRoot, `${entryPath}.md`);
};

const getDocLink = (entryPath: string): string => {
    const normalizedPath = entryPath.replace(/\\/g, '/').replace(/\.md$/, '');

    if (normalizedPath.endsWith('/index')) {
        return `/${normalizedPath.slice(0, -'/index'.length)}/`;
    }

    return `/${normalizedPath}`;
};

const getFallbackTitle = (entryPath: string): string => {
    return entryPath
        .split('/')
        .pop()!
        .replace(/-/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
};

const getDocTitle = (entryPath: string): string => {
    const filePath = getDocPath(entryPath);

    if (!fs.existsSync(filePath)) {
        return getFallbackTitle(entryPath);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(h1Regex);

    if (!match) {
        return getFallbackTitle(entryPath);
    }

    return match[1].replace(zeroWidthRegex, '').trim();
};

const transformSidebarEntry = (entry: SidebarEntry) => {
    if (typeof entry === 'string') {
        return {
            text: getDocTitle(entry),
            link: getDocLink(entry),
        };
    }

    const item = {
        text: entry.title,
        collapsed: entry.collapsable ?? false,
        items: entry.children.map(transformSidebarEntry),
    };

    if (entry.path) {
        return {
            ...item,
            link: getDocLink(entry.path),
        };
    }

    return item;
};

export default defineConfig({
    title: 'Editor',
    description: 'Rich-text authoring for Craft plugins.',
    base: '/editor/',
    // The README is for maintainers of this repository, not a docs page.
    srcExclude: ['README.md'],
    cleanUrls: true,
    head: [
        ['link', { rel: 'icon', type: 'image/svg+xml', href: '/editor/editor-icon.svg' }],
    ],
    appearance: false,
    lastUpdated: true,
    markdown: {
        config(md) {
            // Match the reference containers used by the public documentation renderer.
            md.block.ruler.before('fence', 'reference', (state, startLine, endLine, silent) => {
                const line = (index: number) => state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]).trim();

                if (state.sCount[startLine] - state.blkIndent >= 4 || line(startLine) !== '::: reference') return false;
                if (silent) return true;

                let close = startLine + 1;
                while (close < endLine && line(close) !== ':::') close++;
                if (close === endLine) return false;

                const open = state.push('reference_open', 'div', 1);
                open.block = true;
                open.attrSet('class', 'reference');
                state.md.block.tokenize(state, startLine + 1, close);
                const end = state.push('reference_close', 'div', -1);
                end.block = true;
                state.line = close + 1;
                return true;
            });
        },
    },
    vite: {
        ssr: {
            // mark.js (local search) uses extensionless imports Node can't load during SSR.
            noExternal: ['@verbb/vitepress-theme', 'mark.js'],
        },
        plugins: [
            tailwindcss(),
        ],
        resolve: {
            // The demos run the package source, so the docs always show the current editor
            // without a package build first.
            alias: [
                { find: /^@verbb\/editor$/, replacement: path.join(packageRoot, 'packages/editor/src/index.ts') },
            ],
        },
        server: {
            port: 5412,
            strictPort: true,
            fs: {
                allow: [packageRoot],
            },
        },
    },
    themeConfig: {
        logo: '/editor-logo.svg',
        siteTitle: 'Editor',
        docsTheme: {
            // The Editor brand icon's colour.
            primary: '#4f5fbf',
        },
        sidebar: sidebarConfig.map(transformSidebarEntry),
        search: {
            provider: 'local',
        },
        outline: [2, 3],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/verbb/editor' },
        ],
    },
});
