import assert from "node:assert/strict";
import test from "node:test";
import { constrainViewport, zoomViewport, INITIAL_VIEWPORT } from "../src/types/imageViewport.ts";

test("zoom keeps the image point under the cursor and inverse scrolling restores the view", () => {
  const view = { zoom: 2, offsetX: -50, offsetY: 30 };
  const image = { width: 1000, height: 600 }, area = { width: 800, height: 500 }, pointer = { x: 120, y: -80 };
  const next = zoomViewport(view, -120, pointer, image, area);
  for (const [axis, offset] of [["x", "offsetX"], ["y", "offsetY"]]) {
    assert.ok(Math.abs((pointer[axis] - view[offset]) / view.zoom - (pointer[axis] - next[offset]) / next.zoom) < 1e-8);
  }
  const restored = zoomViewport(next, 120, pointer, image, area);
  assert.ok(Math.abs(restored.zoom - view.zoom) < 1e-8);
  assert.ok(Math.abs(restored.offsetX - view.offsetX) < 1e-8);
  assert.ok(Math.abs(restored.offsetY - view.offsetY) < 1e-8);
});

test("zoom limits and pan bounds keep the image visible; small images remain centered", () => {
  const image = { width: 1000, height: 600 }, area = { width: 1000, height: 600 };
  let view = INITIAL_VIEWPORT;
  for (let step = 0; step < 100; step++) view = zoomViewport(view, -120, { x: 400, y: 200 }, image, area);
  assert.equal(view.zoom, 5);
  const moved = constrainViewport({ ...view, offsetX: 10000, offsetY: -10000 }, image, area);
  assert.deepEqual(moved, { zoom: 5, offsetX: 2000, offsetY: -1200 });
  for (let step = 0; step < 100; step++) view = zoomViewport(view, 120, { x: 400, y: 200 }, image, area);
  assert.deepEqual(view, { zoom: .5, offsetX: 0, offsetY: 0 });
  assert.equal(zoomViewport(view, 0, { x: 0, y: 0 }, image, area), view);
  assert.deepEqual(constrainViewport({ zoom: 1, offsetX: 500, offsetY: 500 }, { width: 200, height: 100 }, area), INITIAL_VIEWPORT);
});
