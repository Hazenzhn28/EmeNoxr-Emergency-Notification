export async function startCamera(videoElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support camera access.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user" }
  });

  videoElement.srcObject = stream;
  try {
    await videoElement.play();
  } catch (error) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    videoElement.srcObject = null;
    throw error;
  }
  return stream;
}

export function stopCamera(videoElement) {
  const stream = videoElement.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  videoElement.srcObject = null;
}
