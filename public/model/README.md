# Teachable Machine model files

Export an **Image Project** from Teachable Machine using the TensorFlow.js
export option. Place the exported `model.json`, `metadata.json`, and referenced
weight file(s) in this directory. The frontend loads `/model/model.json` and
`/model/metadata.json`.

Model assets are ignored by Git because they are project-specific. The
classifier's alert class name must match one of the exported class names.
