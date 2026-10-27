import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelPanelSettle, revealPanel, settlePanel } from '../src/workspace/panelMotion';

function fixture({ reduced = false, duration = '', height = 500 } = {}) {
  const calls: { frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  let measured = 0;
  const animation = { cancel() {} } as Animation;
  const panel = {
    ownerDocument: { defaultView: {
      matchMedia: () => ({ matches: reduced }),
      getComputedStyle: () => ({ getPropertyValue: () => duration }),
    } },
    getBoundingClientRect: () => { measured++; return { left: 100, top: 100, height, width: 400 }; },
    animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => { calls.push({ frames, options }); return animation; },
  } as unknown as HTMLElement;
  const header = { getBoundingClientRect: () => ({ bottom: 160 }) } as HTMLElement;
  return { panel, header, calls, animation, measurements: () => measured };
}

test('reveal preserves the visible header and uses one measurement with no animated layout dimensions', () => {
  const f = fixture();
  assert.equal(revealPanel(f.panel, f.header), f.animation);
  assert.equal(f.measurements(), 1);
  assert.equal(f.calls[0].options.duration, 180);
  assert.match(String(f.calls[0].frames[0].clipPath), /440px/);
  for (const frame of f.calls[0].frames) {
    assert.equal(frame.height, undefined);
    assert.equal(frame.transform, undefined, 'text and the header must not scale or move');
  }
  assert.equal(f.calls[0].options.fill, undefined, 'finished/cancelled effects must not leave the panel clipped');
});

test('reduced motion and disabled effects leave content immediately visible', () => {
  const reduced = fixture({ reduced: true });
  assert.equal(revealPanel(reduced.panel, reduced.header), undefined);
  assert.equal(reduced.measurements(), 0);
  const disabled = fixture({ duration: '0' });
  assert.equal(revealPanel(disabled.panel, disabled.header), undefined);
  const empty = fixture({ height: 60 });
  assert.equal(revealPanel(empty.panel, empty.header), undefined);
});

test('theme duration stays quick and browsers without animation support remain usable', () => {
  const slow = fixture({ duration: '2000' });
  revealPanel(slow.panel, slow.header);
  assert.equal(slow.calls[0].options.duration, 240);
  const invalid = fixture({ duration: 'bad' });
  revealPanel(invalid.panel, invalid.header);
  assert.equal(invalid.calls[0].options.duration, 180);
  const legacy = fixture();
  Object.defineProperty(legacy.panel, 'animate', { value: undefined });
  assert.equal(revealPanel(legacy.panel), undefined);
  assert.equal(legacy.measurements(), 0);
});

test('merge settling measures once and animates only translation and opacity', () => {
  const f = fixture();
  const before = { left: 600, top: 500, width: 700, height: 300 };
  assert.equal(settlePanel(f.panel, before), f.animation);
  assert.equal(f.measurements(), 1);
  assert.equal(f.calls[0].options.duration, 190);
  assert.equal(f.calls[0].frames[0].transform, 'translate3d(96px, 96px, 0)');
  for (const keyframe of f.calls[0].frames) {
    assert.deepEqual(Object.keys(keyframe).sort(), ['opacity', 'transform']);
    assert.ok(!String(keyframe.transform).includes('scale'), 'editor text stays crisp');
  }
  assert.equal(f.calls[0].options.fill, undefined);
});

test('merge settling respects reduced motion and cancels its previous placement animation', () => {
  const reduced = fixture({ reduced: true });
  assert.equal(settlePanel(reduced.panel, { left: 0, top: 0, width: 400, height: 500 }), undefined);
  assert.equal(reduced.measurements(), 0);
  const f = fixture();
  let cancellations = 0;
  f.animation.cancel = () => { cancellations++; };
  settlePanel(f.panel, { left: 20, top: 20, width: 400, height: 500 });
  settlePanel(f.panel, { left: 40, top: 40, width: 400, height: 500 });
  assert.equal(cancellations, 1);
  cancelPanelSettle(f.panel);
  assert.equal(cancellations, 2);
});
