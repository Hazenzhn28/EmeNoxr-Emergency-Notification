const MODEL_URL = "/model/model.json";
const METADATA_URL = "/model/metadata.json";

export async function loadModel() {
  if (!window.tmImage) {
    throw new Error("The Teachable Machine image library did not load.");
  }

  try {
    return await window.tmImage.load(MODEL_URL, METADATA_URL);
  } catch {
    throw new Error("Could not load the model. Check the files in public/model/.");
  }
}

export async function classify(model, videoElement) {
  const predictions = await model.predict(videoElement);
  return predictions.reduce((best, prediction) =>
    prediction.probability > best.probability ? prediction : best
  );
}
