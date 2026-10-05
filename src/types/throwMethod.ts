export const AIM_STANCES = ["站瞄", "蹲瞄"] as const;
export const RELEASE_STANCES = ["站投", "蹲投"] as const;
export const MOVEMENTS = ["原地", "走", "跑"] as const;
export const STEP_COUNTS = ["一步", "两步"] as const;
export const DIRECTION_KEYS = ["W", "A", "D", "S"] as const;
export const DIRECTION_ACTIONS = ["按住", "松开"] as const;
export const THROW_BUTTONS = ["左键", "右键", "双键"] as const;
export const JUMP_MODES = ["跳投", "不跳投"] as const;

export interface ThrowMethod {
  aimStance: (typeof AIM_STANCES)[number];
  releaseStance: (typeof RELEASE_STANCES)[number];
  movement: (typeof MOVEMENTS)[number];
  steps: (typeof STEP_COUNTS)[number];
  direction: (typeof DIRECTION_KEYS)[number];
  directionAction: (typeof DIRECTION_ACTIONS)[number];
  button: (typeof THROW_BUTTONS)[number];
  jump: (typeof JUMP_MODES)[number];
}

export const DEFAULT_THROW_METHOD: Readonly<ThrowMethod> = {
  aimStance: "站瞄",
  releaseStance: "站投",
  movement: "原地",
  steps: "一步",
  direction: "W",
  directionAction: "按住",
  button: "左键",
  jump: "不跳投",
};

export function throwMethodParts(method: ThrowMethod): string[] {
  const moving = method.movement === "走" || method.movement === "跑";
  const movement = moving ? `${method.movement}（${method.steps}）` : method.movement;
  return [
    method.aimStance, method.releaseStance, movement,
    ...(moving ? [`${method.directionAction} ${method.direction}`] : []),
    method.button, method.jump,
  ];
}

// 保持现有 throw_type 文本字段和备份格式。
export function formatThrowMethod(method: ThrowMethod): string {
  return throwMethodParts(method).join(" + ");
}

function isOption<T extends string>(options: readonly T[], value: string): value is T {
  return options.some((option) => option === value);
}

export function parseThrowMethod(value: string): ThrowMethod | null {
  const parts = value.split(" + ");
  if (parts.length !== 5 && parts.length !== 6) return null;
  const [aimStance, releaseStance, movementPart] = parts;
  const button = parts[parts.length - 2];
  const jump = parts[parts.length - 1];
  if (!isOption(AIM_STANCES, aimStance) || !isOption(RELEASE_STANCES, releaseStance)
    || !isOption(THROW_BUTTONS, button) || !isOption(JUMP_MODES, jump)) return null;

  const stepMovement = /^(走|跑)（(一步|两步)）$/.exec(movementPart);
  if (stepMovement) {
    // 旧的走/跑组合未记录方向，按原先默认的向前移动显示。
    let direction: ThrowMethod["direction"] = "W";
    let directionAction: ThrowMethod["directionAction"] = "按住";
    if (parts.length === 6) {
      const directionPart = /^(按住|松开) ([WADS])$/.exec(parts[3]);
      if (!directionPart) return null;
      directionAction = directionPart[1] as ThrowMethod["directionAction"];
      direction = directionPart[2] as ThrowMethod["direction"];
    }
    return {
      aimStance, releaseStance, button, jump, direction, directionAction,
      movement: stepMovement[1] as "走" | "跑",
      steps: stepMovement[2] as ThrowMethod["steps"],
    };
  }
  if (movementPart !== "原地" || parts.length !== 5) return null;
  return { ...DEFAULT_THROW_METHOD, aimStance, releaseStance, button, jump };
}

// 仅在用户主动切换旧笔记为模块组合时使用默认值。
export function convertLegacyThrowMethod(value: string): ThrowMethod {
  const method = { ...DEFAULT_THROW_METHOD };
  if (value === "右键" || value === "右键投掷") method.button = "右键";
  if (value === "左右键" || value === "双键" || value === "双键投掷") method.button = "双键";
  if (value === "Jump Throw" || value === "跳投") method.jump = "跳投";
  if (value === "Run Throw" || value === "跑投") method.movement = "跑";
  if (value === "Walk Throw" || value === "走投") method.movement = "走";
  return method;
}
