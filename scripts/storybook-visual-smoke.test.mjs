import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import {
  PRODUCT_VIEWPORTS,
  catalogJobs,
  installStorybookSmokeProbe,
  reconcileCatalog,
  smokeStory,
} from './storybook-visual-smoke.mjs';

class FakePage extends EventEmitter {
  constructor(onGoto, evaluation = true) {
    super();
    this.onGoto = onGoto;
    this.evaluation = evaluation;
  }

  async addInitScript() {}
  async setViewportSize() {}
  async waitForFunction() {}

  async goto() {
    this.onGoto?.(this);
  }

  async evaluate() {
    return this.evaluation;
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

  it('reports a failure that is not in the known-broken list', () => {
    const problems = reconcileCatalog(
      { failed: [{ storyId: 'a--one', message: 'a--one exploded' }], passed: [] },
      {},
    );
    assert.deepEqual(problems, ['a--one exploded']);
  });

  it('stays silent for a listed failure', () => {
    assert.deepEqual(
      reconcileCatalog(
        { failed: [{ storyId: 'a--one', message: 'a--one exploded' }], passed: [] },
        { 'a--one': 'stale selector' },
      ),
      [],
    );
  });

  // Otherwise the list only ever grows, and a fixed story keeps its exemption.
  it('reports a listed story that has started passing', () => {
    const problems = reconcileCatalog(
      { failed: [], passed: ['a--one'] },
      { 'a--one': 'stale selector' },
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /a--one now passes — remove it/);
  });
});
