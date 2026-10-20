import type { Expression } from "../core/types";

/** Our expressions expressed as VRM preset weights (VRM 0.x and 1.0 share these names in three-vrm). */
export const VRM_EXPRESSIONS: Record<Expression, Record<string, number>> = {
  neutral: {},
  happy: { happy: 0.75 },
  joy: { happy: 1 },
  sad: { sad: 0.9 },
  angry: { angry: 0.9 },
  surprised: { surprised: 0.9 },
  fear: { surprised: 0.5, sad: 0.45 },
  disgust: { angry: 0.45, sad: 0.35 },
  embarrassed: { happy: 0.35, relaxed: 0.5 },
  thinking: { relaxed: 0.35 },
  smug: { happy: 0.35, relaxed: 0.55 },
  love: { happy: 0.7, relaxed: 0.45 },
  sleepy: { relaxed: 1 },
  confused: { sad: 0.3, surprised: 0.35 },
};

/**
 * Common morph-target names on non-VRM glTF models (VRoid exports, MMD-derived,
 * ARKit blendshape rigs). Used when the user hasn't mapped expressions by hand.
 */
export const GLTF_GUESSES: Record<Expression, string[][]> = {
  neutral: [],
  happy: [["Fcl_ALL_Joy", "Joy", "happy", "Smile", "smile", "mouthSmile", "mouthSmileLeft"]],
  joy: [["Fcl_ALL_Fun", "Fun", "joy", "laugh", "Smile"]],
  sad: [["Fcl_ALL_Sorrow", "Sorrow", "sad", "browInnerUp"]],
  angry: [["Fcl_ALL_Angry", "Angry", "angry", "browDownLeft"]],
  surprised: [["Fcl_ALL_Surprised", "Surprised", "surprised", "jawOpen"]],
  fear: [["Fcl_ALL_Surprised", "Surprised", "fear"]],
  disgust: [["Fcl_ALL_Angry", "disgust", "noseSneerLeft"]],
  embarrassed: [["blush", "Blush", "Fcl_ALL_Joy"]],
  thinking: [["Fcl_BRW_Sorrow", "think", "browInnerUp"]],
  smug: [["smug", "Fcl_MTH_Fun", "mouthSmileLeft"]],
  love: [["Fcl_ALL_Joy", "love", "heart"]],
  sleepy: [["Fcl_EYE_Close", "sleepy", "eyeBlinkLeft"]],
  confused: [["Fcl_BRW_Surprised", "confused"]],
};

export const MOUTH_GUESSES = ["aa", "A", "Fcl_MTH_A", "jawOpen", "mouthOpen", "vrc.v_aa", "あ"];
export const BLINK_GUESSES = ["blink", "Blink", "Fcl_EYE_Close", "eyeBlink", "eyeBlinkLeft", "まばたき"];
