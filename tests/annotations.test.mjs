import assert from "node:assert/strict";
import test from "node:test";
import { parseActions, createHistory, commitHistory, undoHistory, redoHistory, moveAction, resizeAction, handlesFor, hitTest, textBounds, actionBounds } from "../src/types/annotations.ts";

const rect = { id: "r", tool: "rect", start: { x: .1, y: .2 }, end: { x: .4, y: .5 }, color: "#ff4d4f", width: 5 };
const text = { id: "t", tool: "text", point: { x: .2, y: .4 }, text: "旧文字", color: "#ffffff", fontSize: 32 };
const measure = (action) => textBounds(action, 1000, 500, (value, font) => value.length * font);

test("legacy actions gain stable unique IDs without changing coordinates, style or baseline", () => {
  const old = JSON.stringify([{ ...rect, id: undefined }, { ...text, id: undefined }, { ...rect, id: "same" }, { ...text, id: "same" }]);
  const actions = parseActions(old);
  assert.equal(actions.length, 4);
  assert.equal(new Set(actions.map((action) => action.id)).size, 4);
  assert.deepEqual(actions[0].start, rect.start);
  assert.equal(actions[1].textBaseline, undefined);
  assert.deepEqual(parseActions(JSON.stringify(actions)), actions);
  assert.deepEqual(parseActions("broken"), []);
  assert.equal(parseActions(JSON.stringify([{ ...rect, width: -1 }, { ...rect, end: { x: 2, y: 0 } }, text])).length, 1);
});

test("moving and resizing existing objects is reversible, branch edits invalidate redo and clearing is undoable", () => {
  let history = createHistory([rect, text]);
  const moved = moveAction(rect, { x: .2, y: .1 }, measure);
  history = commitHistory(history, [moved, text]);
  const resized = resizeAction(moved, "se", { x: .8, y: .9 });
  history = commitHistory(history, [resized, { ...text, text: "修改第一行\n第二行", textBaseline: "top" }]);
  history = commitHistory(history, [resized]);
  history = undoHistory(history);
  assert.equal(history.present[1].text, "修改第一行\n第二行");
  history = undoHistory(history);
  assert.deepEqual(history.present, [moved, text]);
  history = redoHistory(history);
  assert.deepEqual(history.present[0], resized);
  history = commitHistory(history, [{ ...resized, color: "#31a8ff" }, history.present[1]]);
  assert.equal(history.future.length, 0);
  const beforeClear = history.present;
  history = commitHistory(history, []);
  assert.deepEqual(undoHistory(history).present, beforeClear);
  assert.equal(commitHistory(history, []).past.length, history.past.length);
  assert.deepEqual(rect.start, { x: .1, y: .2 });
});

test("whole-object movement stays within the image and preserves freehand shape", () => {
  const moved = moveAction(rect, { x: 10, y: -10 }, measure);
  assert.ok(Math.abs(moved.end.x - 1) < 1e-10);
  assert.equal(moved.start.y, 0);
  assert.ok(Math.abs((moved.end.x - moved.start.x) - .3) < 1e-10);
  const pen = { id: "p", tool: "pen", color: "#ffffff", width: 3, points: [{ x: .1, y: .2 }, { x: .3, y: .4 }] };
  assert.deepEqual(moveAction(pen, { x: .1, y: .1 }, measure).points, [{ x: .2, y: .30000000000000004 }, { x: .4, y: .5 }]);
  assert.deepEqual(pen.points[0], { x: .1, y: .2 });
});

test("rectangles and ellipses resize across opposite corners; arrow endpoints remain independent", () => {
  const reversed = { ...rect, start: rect.end, end: rect.start };
  for (const tool of ["rect", "circle"]) {
    const changed = resizeAction({ ...reversed, tool }, "nw", { x: .8, y: .9 });
    assert.deepEqual(changed.start, rect.end);
    assert.deepEqual(changed.end, { x: .8, y: .9 });
    assert.equal(handlesFor(changed).length, 4);
  }
  const arrow = { ...rect, tool: "arrow" };
  assert.deepEqual(resizeAction(arrow, "end", { x: .8, y: .7 }).start, arrow.start);
  assert.equal(handlesFor(arrow).length, 2);
});

test("hit detection chooses the topmost object and works in non-square image coordinates", () => {
  const arrow = { ...rect, tool: "arrow", id: "a" };
  const pen = { id: "p", tool: "pen", color: "#ffffff", width: 3, points: [{ x: .1, y: .2 }, { x: .4, y: .5 }] };
  assert.equal(hitTest([arrow, pen], { x: .25, y: .35 }, 1000, 500, 5, measure).id, "p");
  assert.equal(hitTest([rect], { x: .25, y: .2 }, 1000, 500, 5, measure).id, "r");
  assert.equal(hitTest([rect], { x: .25, y: .35 }, 1000, 500, 5, measure), null);
  const circle = { ...rect, tool: "circle", id: "c" };
  assert.equal(hitTest([circle], { x: .4, y: .35 }, 1000, 500, 5, measure).id, "c");
  assert.equal(hitTest([circle], { x: .25, y: .35 }, 1000, 500, 5, measure), null);
  assert.equal(hitTest([text], { x: .21, y: .39 }, 1000, 500, 5, measure).id, "t");
});

test("multiline text keeps line breaks, grows the hit area and preserves legacy baseline on reopening", () => {
  const multiline = { ...text, text: "第一行\r\n\r\n第三行", textBaseline: "top" };
  const reopened = parseActions(JSON.stringify([multiline]))[0];
  assert.equal(reopened.text, "第一行\n\n第三行");
  assert.equal(measure(reopened).top, .4);
  assert.ok(measure(reopened).bottom > measure({ ...reopened, text: "第一行" }).bottom);
  assert.ok(measure(text).top < text.point.y);
  const extremelyWide = { ...text, fontSize: 1000 };
  const moved = moveAction(extremelyWide, { x: 1, y: 1 }, (action) => textBounds(action, 4000, 100, () => 5000));
  assert.equal(parseActions(JSON.stringify([moved])).length, 1);
});

test("large freehand bounds do not overflow the JavaScript call stack", () => {
  const pen = { id: "large", tool: "pen", color: "#ffffff", width: 3, points: Array.from({ length: 150000 }, () => ({ x: .2, y: .3 })) };
  assert.deepEqual(actionBounds(pen, measure), { left: .2, top: .3, right: .2, bottom: .3 });
});
