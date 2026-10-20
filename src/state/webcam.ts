/** Webcam frame grab — only ever called when the user has enabled webcam vision. */
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter((d) => d.kind === "videoinput");
}

async function ensureStream(deviceId: string): Promise<HTMLVideoElement> {
  if (stream && video) return video;
  stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" },
    audio: false,
  });
  video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return video;
}

export async function grabWebcamFrame(deviceId: string, maxWidth: number): Promise<{ mime: string; data: string }> {
  const v = await ensureStream(deviceId);
  const scale = Math.min(1, maxWidth / (v.videoWidth || maxWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((v.videoWidth || 640) * scale);
  canvas.height = Math.round((v.videoHeight || 480) * scale);
  canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.8);
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}

/** Turn the camera off (and its light) as soon as webcam vision is disabled. */
export function releaseWebcam(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video = null;
}
