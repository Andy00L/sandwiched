type CaptureFrame = () => HTMLCanvasElement | null;

let registeredCapture: CaptureFrame | null = null;

export function registerSceneCapture(capture: CaptureFrame): void {
  registeredCapture = capture;
}

export function captureSceneFrame(): HTMLCanvasElement | null {
  return registeredCapture === null ? null : registeredCapture();
}
