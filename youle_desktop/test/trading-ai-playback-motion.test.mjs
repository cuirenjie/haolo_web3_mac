import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingAiDrawingPlaybackController } from '../src/renderer/trading-expert-ai-playback.ts';

const points = [{ time: 100, price: 10 }, { time: 200, price: 30 }, { time: 300, price: 15 }];
const shape = (tool, anchors = points.slice(0, 2)) => ({ id: tool, tool, points: anchors, locked: true });

async function simulate(drawings, { reduced = false, intervals = [16], speed = 1, hiddenFrames = [], stopAtFrame, cancelAtFrame } = {}) {
  const previous = globalThis.window;
  const frames = [], commits = [], cursors = [], phases = [], queue = [];
  let time = 0, tick = 0, hidden = false, active = true, done = false, error;
  globalThis.window = {
    document: { get visibilityState() { return hidden ? 'hidden' : 'visible'; } },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (fn, ms) => queue.push(() => { time += ms; fn(); }),
    requestAnimationFrame: fn => queue.push(() => {
      hidden = hiddenFrames.includes(tick);
      time += intervals[tick % intervals.length];
      tick++;
      fn(time);
    }),
  };
  try {
    const playback = new TradingAiDrawingPlaybackController({
      setDraft: (draft, opacity = 1) => {
        if (!draft) return;
        frames.push({ draft: structuredClone(draft), opacity, tick, hidden, cursor: structuredClone(cursors.at(-1)?.point) });
        if (frames.length === stopAtFrame) active = false;
        if (frames.length === cancelAtFrame) playback.cancel();
      },
      commit: drawing => commits.push(structuredClone(drawing)),
      setCursor: (point, pulse) => cursors.push({ point, pulse }),
    });
    const playing = playback.play(drawings, {
      speedMultiplier: speed, shouldContinue: () => active, onPhase: phase => phases.push(phase),
    }).then(() => { done = true; }, e => { error = e; done = true; });
    for (let i = 0; !done && i < 10000; i++) { queue.shift()?.(); await Promise.resolve(); }
    assert.equal(done, true, 'playback settles');
    await playing;
    if (error) throw error;
    return { frames, commits, cursors, phases };
  } finally { globalThis.window = previous; }
}

for (const reduced of [false, true]) {
  for (const [name, intervals] of [['60fps', [16]], ['30fps', [33]], ['10fps', [100]], ['long stalls', [16, 1500, 250]]]) {
    test(`${reduced ? 'reduced' : 'normal'} motion: ${name} draws each segment before committing`, async () => {
      const drawings = [shape('path', points), shape('rectangle'), shape('circle'), shape('ellipse')];
      const result = await simulate(drawings, { reduced, intervals });
      assert.deepEqual(result.commits, drawings);
      for (const drawing of drawings) {
        for (let segment = 1; segment < drawing.points.length; segment++) {
          const intermediate = result.frames.filter(({ draft }) => draft.id === drawing.id
            && draft.points.length === segment + 1
            && draft.points.at(-1).time > drawing.points[segment - 1].time
            && draft.points.at(-1).time < drawing.points[segment].time);
          assert.ok(intermediate.length >= 4, `${drawing.id} segment ${segment} needs observable intermediate geometry, got ${intermediate.length}`);
        }
      }
      for (const frame of result.frames) assert.deepEqual(frame.cursor, frame.draft.points.at(-1), 'cursor tracks the visible stroke in either system preference');
      assert.equal(result.cursors.at(-1).point, null, 'completion clears the cursor');
      if (reduced) assert.ok(result.cursors.every(cursor => !cursor.pulse), 'reduced motion keeps click pulses disabled');
    });
  }

  test(`${reduced ? 'reduced' : 'normal'} motion: hidden frames do not consume geometry`, async () => {
    const result = await simulate([shape('path')], { reduced, intervals: [1000], hiddenFrames: [1, 2, 3, 4, 5] });
    assert.ok(result.frames.every(frame => !frame.hidden), 'no hidden drawing updates');
    const resumed = result.frames.find(frame => frame.tick > 6);
    assert.ok(resumed.draft.points.at(-1).time < 200, 'resume must not jump to the endpoint');
    assert.equal(result.commits.length, 1);
  });

  test(`${reduced ? 'reduced' : 'normal'} motion: single-point marks fade and final objects stay unchanged`, async () => {
    const drawings = [shape('arrow-up', points.slice(0, 1)), { ...shape('text', points.slice(1, 2)), text: '支撑 Support' }, { ...shape('note', points.slice(2, 3)), text: '阻力 Resistance' }];
    const result = await simulate(drawings, { reduced });
    for (const drawing of drawings) {
      if (drawing.tool !== 'note' || reduced) assert.ok(result.frames.filter(frame => frame.draft.id === drawing.id && frame.opacity > 0 && frame.opacity < 1).length >= 4);
      const frames = result.frames.filter(frame => frame.draft.id === drawing.id);
      assert.ok(frames.length > 0);
      for (const frame of frames) assert.deepEqual(frame.cursor, drawing.points[0], 'each single-point or text object has its own cursor');
    }
    assert.deepEqual(result.commits, drawings);
  });

  test(`${reduced ? 'reduced' : 'normal'} motion: cancellation during slow frames never commits partial or remaining drawings`, async () => {
    const result = await simulate([shape('path'), shape('rectangle')], { reduced, intervals: [500], stopAtFrame: 3 });
    assert.deepEqual(result.commits, []);
    assert.equal(result.phases.at(-1), 'cancelled');
    assert.equal(result.cursors.at(-1).point, null, 'stopping playback clears the cursor');
  });

  test(`${reduced ? 'reduced' : 'normal'} motion: explicit cancellation clears a visible cursor`, async () => {
    const result = await simulate([shape('path'), shape('rectangle')], { reduced, cancelAtFrame: 3 });
    assert.ok(result.cursors.some(cursor => cursor.point !== null));
    assert.equal(result.cursors.at(-1).point, null);
    assert.deepEqual(result.commits, []);
    assert.equal(result.phases.at(-1), 'cancelled');
  });
}

test('even a very large speed multiplier cannot collapse a segment into one displayed frame', async () => {
  for (const reduced of [false, true]) {
    const result = await simulate([shape('path')], { speed: 100, reduced });
    assert.ok(result.frames.filter(frame => frame.draft.points.at(-1).time > 100 && frame.draft.points.at(-1).time < 200).length >= 4);
    for (const frame of result.frames) assert.deepEqual(frame.cursor, frame.draft.points.at(-1));
  }
});
