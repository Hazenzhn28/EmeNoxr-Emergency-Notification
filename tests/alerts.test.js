const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAlert } = require("../src/routes/alerts");

test("validates an alert payload and trims the class name", () => {
  assert.deepEqual(validateAlert({
    className: "  Seizure  ",
    confidence: 0.92,
    test: false
  }), {
    value: { className: "Seizure", confidence: 0.92, test: false }
  });
});

test("rejects invalid alert fields", () => {
  assert.match(validateAlert({ className: "", confidence: 0.5 }).error, /className/);
  assert.match(validateAlert({ className: "Seizure", confidence: 1.2 }).error, /confidence/);
  assert.match(validateAlert({ className: "Seizure", confidence: 0.5, test: "yes" }).error, /test/);
});
