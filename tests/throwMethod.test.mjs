import assert from "node:assert/strict";
import test from "node:test";
import {
  AIM_STANCES, RELEASE_STANCES, THROW_BUTTONS, JUMP_MODES, DIRECTION_KEYS, DIRECTION_ACTIONS,
  DEFAULT_THROW_METHOD, formatThrowMethod, parseThrowMethod, convertLegacyThrowMethod,
} from "../src/types/throwMethod.ts";

test("all 792 combinations survive saving and reopening with direction and action", () => {
  const movementOptions = [{ movement: "原地", steps: "一步", direction: "W", directionAction: "按住" }];
  for (const movement of ["走", "跑"]) {
    for (const steps of ["一步", "两步"]) {
      for (const direction of DIRECTION_KEYS) {
        for (const directionAction of DIRECTION_ACTIONS) {
          movementOptions.push({ movement, steps, direction, directionAction });
        }
      }
    }
  }
  const savedValues = new Set();
  for (const aimStance of AIM_STANCES) {
    for (const releaseStance of RELEASE_STANCES) {
      for (const movementOption of movementOptions) {
        for (const button of THROW_BUTTONS) {
          for (const jump of JUMP_MODES) {
            const method = { aimStance, releaseStance, ...movementOption, button, jump };
            const saved = formatThrowMethod(method);
            savedValues.add(saved);
            assert.deepEqual(parseThrowMethod(saved), method, saved);
          }
        }
      }
    }
  }
  assert.equal(savedValues.size, 792);
});

test("directions and press/release appear in the final combination", () => {
  assert.equal(formatThrowMethod({ ...DEFAULT_THROW_METHOD, movement: "走", steps: "两步", direction: "A", jump: "跳投" }), "站瞄 + 站投 + 走（两步） + 按住 A + 左键 + 跳投");
  assert.equal(parseThrowMethod("蹲瞄 + 蹲投 + 跑（一步） + 松开 S + 双键 + 不跳投")?.directionAction, "松开");
  assert.equal(parseThrowMethod("蹲瞄 + 蹲投 + 跑（一步） + 松开 S + 双键 + 不跳投")?.direction, "S");
});

test("old walking and running combinations reopen with default forward direction", () => {
  for (const movement of ["走", "跑"]) {
    const method = parseThrowMethod(`蹲瞄 + 站投 + ${movement}（两步） + 右键 + 跳投`);
    assert.deepEqual(method, { ...DEFAULT_THROW_METHOD, aimStance: "蹲瞄", movement, steps: "两步", button: "右键", jump: "跳投" });
  }
});

test("legacy and malformed text are left for the legacy editor instead of guessed", () => {
  for (const movement of ["按住 W", "松开 W", "+w", "-w", "w+"]) {
    assert.equal(parseThrowMethod(`站瞄 + 站投 + ${movement} + 左键 + 跳投`), null);
  }
  for (const value of ["", "Jump Throw", "左右键", "自定义：蹲下后松开右键", "站瞄 + 蹲投 + 走 + 左键 + 跳投", "站瞄 + 蹲投 + 跑（三步） + 左键 + 跳投", "站瞄 + 站投 + 原地 + 中键 + 跳投", "站瞄 + 站投 + 原地 + 左键 + 是", "站瞄 + 站投 + 原地 + 左键 + 跳投 + 其他"]) {
    assert.equal(parseThrowMethod(value), null, value);
  }
  for (const value of ["站瞄 + 站投 + 原地 + 按住 W + 左键 + 跳投", "站瞄 + 站投 + 走（一步） + 按住 Q + 左键 + 跳投", "站瞄 + 站投 + 跑（两步） + 点击 W + 左键 + 跳投"]) {
    assert.equal(parseThrowMethod(value), null, value);
  }
});

test("explicit conversion retains the known part of legacy presets", () => {
  assert.equal(convertLegacyThrowMethod("Jump Throw").jump, "跳投");
  assert.equal(convertLegacyThrowMethod("Run Throw").movement, "跑");
  assert.equal(convertLegacyThrowMethod("Walk Throw").movement, "走");
  assert.equal(convertLegacyThrowMethod("左右键").button, "双键");
  assert.equal(convertLegacyThrowMethod("右键").button, "右键");
  assert.deepEqual(convertLegacyThrowMethod(""), DEFAULT_THROW_METHOD);
});

test("stationary results omit and reset hidden steps and direction", () => {
  const saved = formatThrowMethod({ ...DEFAULT_THROW_METHOD, steps: "两步", direction: "D", directionAction: "松开" });
  assert.equal(saved, "站瞄 + 站投 + 原地 + 左键 + 不跳投");
  assert.deepEqual(parseThrowMethod(saved), DEFAULT_THROW_METHOD);
});
