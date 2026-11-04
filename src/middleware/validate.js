// Validates and REPLACES req.body with the parsed result, so handlers only ever
// see sanitized, typed data (trimmed, lowercased, unknown keys rejected).
function validateBody(schema) {
  return function validate(req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid input.",
        details: result.error.issues.map(issue => ({
          field: issue.path.join("."),
          message: issue.message
        }))
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };