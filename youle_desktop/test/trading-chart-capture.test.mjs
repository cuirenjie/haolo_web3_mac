import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureTradingChart, normalizeTradingChartCaptureRect } from '../src/main/trading-chart-capture.mjs';

const rect = { x: 50, y: 40, width: 600, height: 500 };
const image = { isEmpty: () => false, toPNG: () => Buffer.from('test-image'), getSize: () => ({ width: 600, height: 500 }) };
const makeWindow = (zoom = 1) => ({
  isDestroyed: () => false, getContentSize: () => [1000, 800],
  webContents: { isDestroyed: () => false, getZoomFactor: () => zoom, capturePage: async () => image },
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'haolo-chart-capture-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('haolo-chart-capture-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const copied = [];
  return { directory, copied, dependencies: {
    app: { getPath: name => path.join(directory, name) },
    clipboard: { writeImage: value => copied.push(value) },
  } };
}

test('capture rectangle handles page zoom and clips to the content viewport', () => {
  assert.deepEqual(normalizeTradingChartCaptureRect(makeWindow(1.25), rect), { x: 62, y: 50, width: 751, height: 625 });
  assert.deepEqual(normalizeTradingChartCaptureRect(makeWindow(1.5), { x: -10, y: 400, width: 800, height: 300 }), { x: 0, y: 600, width: 1000, height: 200 });
  for (const invalid of [null, {}, { ...rect, width: NaN }, { ...rect, height: 0 }, { ...rect, x: 1500 }, { ...rect, x: -1000 }]) {
    assert.equal(normalizeTradingChartCaptureRect(makeWindow(), invalid), null);
  }
});

test('desktop capture writes unique PNG files and copies the exact captured image', async t => {
  const { directory, copied, dependencies } = await fixture(t);
  const results = await Promise.all([1, 2].map(() => captureTradingChart(makeWindow(), { rect, destination: 'desktop' }, dependencies)));
  assert.notEqual(results[0].path, results[1].path);
  for (const result of results) {
    assert.equal(result.ok, true); assert.equal(result.copied, true);
    assert.equal(path.dirname(result.path), path.join(directory, 'desktop'));
    assert.equal(path.extname(result.path), '.png');
    assert.deepEqual(await fs.readFile(result.path), image.toPNG());
  }
  assert.deepEqual(copied, [image, image]);
});

test('existing attachment capture remains temporary and leaves clipboard untouched', async t => {
  const { directory, copied, dependencies } = await fixture(t);
  const result = await captureTradingChart(makeWindow(), { rect }, dependencies);
  assert.equal(path.dirname(result.path), path.join(directory, 'temp', 'haolo-trading-captures'));
  assert.equal(result.ok, true); assert.deepEqual(copied, []);
});

test('save failure does not copy or report success; clipboard failure preserves saved file', async t => {
  const { directory, copied, dependencies } = await fixture(t);
  await fs.writeFile(path.join(directory, 'desktop'), 'blocks directory');
  await assert.rejects(captureTradingChart(makeWindow(), { rect, destination: 'desktop' }, dependencies));
  assert.deepEqual(copied, []);
  await fs.unlink(path.join(directory, 'desktop'));
  dependencies.clipboard.writeImage = () => { throw new Error('clipboard busy'); };
  const result = await captureTradingChart(makeWindow(), { rect, destination: 'desktop' }, dependencies);
  assert.equal(result.ok, true); assert.equal(result.copied, false);
  assert.match(result.message, /复制到剪贴板失败/);
  assert.deepEqual(await fs.readFile(result.path), image.toPNG());
});

test('unavailable windows and empty captures cannot create files or touch clipboard', async t => {
  const { directory, copied, dependencies } = await fixture(t);
  const emptyWindow = makeWindow();
  emptyWindow.webContents.capturePage = async () => ({ isEmpty: () => true });
  for (const window of [null, { isDestroyed: () => true }, emptyWindow]) {
    assert.equal((await captureTradingChart(window, { rect, destination: 'desktop' }, dependencies)).ok, false);
  }
  assert.deepEqual(await fs.readdir(directory), []); assert.deepEqual(copied, []);
});
