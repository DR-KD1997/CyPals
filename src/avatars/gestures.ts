/**
 * Procedural gestures for humanoid (VRM) rigs, used when a model has no
 * animation clip for an action. Each returns bone rotation offsets (radians,
 * Euler XYZ on normalized bones) for progress t ∈ [0,1].
 */
export type BoneOffsets = Partial<Record<string, [number, number, number]>>;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** Rise, hold, fall envelope. */
const env = (t: number, rise = 0.2, fall = 0.25) => (t < rise ? ease(t / rise) : t > 1 - fall ? ease((1 - t) / fall) : 1);

export const GESTURE_DURATION: Record<string, number> = {
  wave: 2.2, nod: 1.1, shake_head: 1.3, laugh: 1.6, shrug: 1.4, bow: 2, think: 2.6, clap: 1.8, point: 1.8,
};

export function gesture(name: string, t: number): BoneOffsets {
  const e = env(t);
  switch (name) {
    case "wave":
      return {
        rightUpperArm: [0, 0, -2.3 * e],
        rightLowerArm: [0, -0.3 * e, -0.5 * e + Math.sin(t * Math.PI * 8) * 0.35 * e],
        head: [0, 0, -0.08 * e],
      };
    case "nod":
      return { head: [Math.sin(t * Math.PI * 4) * 0.22 * env(t, 0.1, 0.2), 0, 0], neck: [0.05 * e, 0, 0] };
    case "shake_head":
      return { head: [0, Math.sin(t * Math.PI * 6) * 0.3 * env(t, 0.1, 0.2), 0] };
    case "laugh":
      return { spine: [Math.abs(Math.sin(t * Math.PI * 7)) * 0.08 * e, 0, 0], head: [-0.15 * e, 0, 0.05 * e] };
    case "shrug":
      return {
        leftShoulder: [0, 0, 0.25 * e], rightShoulder: [0, 0, -0.25 * e],
        leftLowerArm: [0, 0.9 * e, 0], rightLowerArm: [0, -0.9 * e, 0], head: [0, 0, 0.12 * e],
      };
    case "bow":
      return { spine: [0.35 * e, 0, 0], chest: [0.25 * e, 0, 0], head: [0.2 * e, 0, 0] };
    case "think":
      return {
        rightUpperArm: [0, 0, -0.9 * e], rightLowerArm: [0, -2.1 * e, 0],
        head: [0.05 * e, -0.15 * e, 0.12 * e],
      };
    case "clap": {
      const c = Math.abs(Math.sin(t * Math.PI * 10)) * e;
      return {
        leftUpperArm: [0, 0.6 * e, 1.0 * e], rightUpperArm: [0, -0.6 * e, -1.0 * e],
        leftLowerArm: [0, 1.4 * e + 0.25 * c, 0], rightLowerArm: [0, -1.4 * e - 0.25 * c, 0],
      };
    }
    case "point":
      return { rightUpperArm: [0, -0.6 * e, -1.25 * e], rightLowerArm: [0, -0.15 * e, 0] };
    default:
      return { spine: [Math.sin(t * Math.PI * 2) * 0.05 * e, 0, 0] };
  }
}
