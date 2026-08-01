import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import {
  PRODUCT_VIEWPORTS,
  catalogJobs,
  installStorybookSmokeProbe,
  runJobs,
  smokeStory,
} from './storybook-visual-smoke.mjs';

// The real in-page evaluate always returns this shape; a fake that answers
// `true` lets a branch survive in the script that production never reaches.
const RENDERED = { hasContent: true, failures: [] };

class FakePage extends EventEmitter {
  constructor(onGoto, evaluation = RENDERED) {
    super();
    this.onGoto = onGoto;
    this.evaluation = evaluation;
    this.closed = false;
  }

  async addInitScript() {}
  async setViewportSize() {}
  async waitForFunction() {}

  async goto(url) {
    this.onGoto?.(this, url);
  }

  async evaluate() {
    return this.evaluation;
  }

  async close() {
    this.closed = true;
  }
}

const job = {
  surface: 'skills',
  storyId: 'product-module-hubs--extensions-skills',
  viewport: 'floor',
  size: { width: 480, height: 900 },
};

describe('Product Storybook browser smoke', () => {
  it('captures Storybook play-function failures', () => {
    const handlers = {};
    const previousWindow = globalThis.window;
    globalThis.window = {
      __STORYBOOK_PREVIEW__: {
        channel: {
          on(eventName, handler) {
            handlers[eventName] = handler;
          },
        },
      },
      addEventListener() {},
      setTimeout,
    };
    try {
      installStorybookSmokeProbe({ storyId: job.storyId });
      handlers.storyFinished({ storyId: job.storyId, status: 'error', error: new Error('boom') });
      assert.deepEqual(globalThis.window.__makaStorybookSmoke.failures, ['storyFinished: boom']);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('fails on browser errors and empty content', async () => {
    const pageError = new FakePage((page) => page.emit('pageerror', new Error('render exploded')));
    await assert.rejects(
      () => smokeStory(pageError, 'http://storybook.test', job),
      /render exploded/,
    );

    const empty = new FakePage(undefined, { hasContent: false, failures: [] });
    await assert.rejects(() => smokeStory(empty, 'http://storybook.test', job), /empty content/);
  });
});

describe('catalog pass', () => {
  const index = {
    entries: {
      'a--one': { id: 'a--one', type: 'story' },
      'a--two': { id: 'a--two', type: 'story' },
      'a--docs': { id: 'a--docs', type: 'docs' },
    },
  };

  it('renders every story the manifest does not already cover, and no docs entries', () => {
    assert.deepEqual(
      catalogJobs(index, [{ storyId: 'a--one' }]).map((job) => job.storyId),
      ['a--two'],
    );
    assert.deepEqual(
      catalogJobs(index, []).map((job) => job.storyId),
      ['a--one', 'a--two'],
    );
  });

  it('uses one wide/light render per story', () => {
    const [job] = catalogJobs(index, [{ storyId: 'a--two' }]);
    assert.deepEqual(job, {
      storyId: 'a--one',
      viewport: 'catalog',
      size: PRODUCT_VIEWPORTS.wide,
      colorScheme: 'light',
    });
  });
});

describe('runJobs', () => {
  // One broken story must not hide the ones queued behind it: a run that stops
  // at the first failure reports one problem per CI round, and needs as many
  // rounds as there are broken stories before it converges.
  it('attempts every job and collects each story failure', async () => {
    const ids = ['a--one', 'a--two', 'a--three', 'a--four', 'a--five'];
    const broken = new Set(['a--two', 'a--five']);
    const pages = [];
    const browser = {
      async newPage() {
        const page = new FakePage((current, url) => {
          const storyId = new URL(url).searchParams.get('id');
          if (broken.has(storyId)) current.emit('pageerror', new Error(`${storyId} exploded`));
        });
        pages.push(page);
        return page;
      },
    };

    const failures = await runJobs(
      browser,
      'http://storybook.test',
      ids.map((storyId) => ({ storyId, viewport: 'catalog', size: PRODUCT_VIEWPORTS.wide })),
      3,
    );

    assert.equal(pages.length, ids.length);
    assert.deepEqual(
      failures.map((message) => message.split(' ')[0]),
      ['[a--two', '[a--five'],
    );
    assert.ok(pages.every((page) => page.closed));
  });
});
