import { useId } from "react";
import { throwTypeLabel } from "../types/note";
import {
  AIM_STANCES, RELEASE_STANCES, MOVEMENTS, STEP_COUNTS, DIRECTION_KEYS, DIRECTION_ACTIONS, THROW_BUTTONS, JUMP_MODES,
  convertLegacyThrowMethod, formatThrowMethod, parseThrowMethod, throwMethodParts,
  type ThrowMethod,
} from "../types/throwMethod";

interface ThrowMethodPickerProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function ModuleChoices<T extends string>({ label, options, value, disabled, onChange, labels }: {
  label: string;
  options: readonly T[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  const name = useId();
  return (
    <fieldset className="throw-module" disabled={disabled}>
      <legend>{label}</legend>
      <div className="throw-module-options">
        {options.map((option) => (
          <label key={option} className={`throw-choice${value === option ? " selected" : ""}`}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            <span>{labels?.[option] ?? option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ThrowMethodPicker({ value, disabled, onChange }: ThrowMethodPickerProps) {
  const method = parseThrowMethod(value);
  const setModule = <K extends keyof ThrowMethod>(key: K, next: ThrowMethod[K]) => {
    if (method) onChange(formatThrowMethod({ ...method, [key]: next }));
  };

  return (
    <div className="throw-method-picker">
      <div className="throw-method-heading">
        <strong>投掷方式</strong>
        {value && <button type="button" className="text-button" disabled={disabled} onClick={() => onChange("")}>清空</button>}
      </div>
      {method ? (
        <>
          <p className="throw-method-help">每组选择一个模块，拼出这个瞄点的完整投掷方式。</p>
          <div className="throw-module-pair">
            <ModuleChoices label="瞄准姿势" options={AIM_STANCES} value={method.aimStance} disabled={disabled} onChange={(next) => setModule("aimStance", next)} />
            <ModuleChoices label="投掷姿势" options={RELEASE_STANCES} value={method.releaseStance} disabled={disabled} onChange={(next) => setModule("releaseStance", next)} />
          </div>
          <ModuleChoices label="移动方式" options={MOVEMENTS} value={method.movement} disabled={disabled} onChange={(next) => setModule("movement", next)} />
          {(method.movement === "走" || method.movement === "跑") && (
            <>
              <ModuleChoices label={`${method.movement}几步`} options={STEP_COUNTS} value={method.steps} disabled={disabled} onChange={(next) => setModule("steps", next)} />
              <div className="throw-direction-region">
                <ModuleChoices label="方向" options={DIRECTION_KEYS} value={method.direction} disabled={disabled} onChange={(next) => setModule("direction", next)} />
                <ModuleChoices label="方向按键动作" options={DIRECTION_ACTIONS} value={method.directionAction} disabled={disabled} onChange={(next) => setModule("directionAction", next)} />
              </div>
            </>
          )}
          <div className="throw-module-pair">
            <ModuleChoices label="投掷按键" options={THROW_BUTTONS} value={method.button} disabled={disabled} onChange={(next) => setModule("button", next)} />
            <ModuleChoices label="是否跳投" options={JUMP_MODES} value={method.jump} labels={{ 跳投: "是", 不跳投: "否" }} disabled={disabled} onChange={(next) => setModule("jump", next)} />
          </div>
          <div className="throw-method-preview" role="status" aria-live="polite" aria-atomic="true">
            <span>组合结果</span>
            <div className="throw-method-parts">
              {throwMethodParts(method).map((part, index) => (
                <span className="throw-method-part" key={index}>{part}</span>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="throw-method-legacy">
          <p>{value ? `原投掷方式：${throwTypeLabel(value)}` : "未设置投掷方式"}</p>
          {value && <small>原记录会保留；切换后可按模块重新选择。</small>}
          <button type="button" className="secondary-button" disabled={disabled} onClick={() => onChange(formatThrowMethod(convertLegacyThrowMethod(value)))}>
            {value ? "改为模块组合" : "设置模块组合"}
          </button>
        </div>
      )}
    </div>
  );
}
