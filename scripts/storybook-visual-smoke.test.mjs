import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import {
  PRODUCT_VIEWPORTS,
  catalogJobs,
  installStorybookSmokeProbe,
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
});
