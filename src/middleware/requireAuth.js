// Requires cookie-parser to run earlier in the middleware chain.
function createRequireAuth(authService) {
  return function requireAuth(req, res, next) {
    const token = req.cookies?.[authService.cookieName];
    if (!token) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    try {
      // req.user.id is the ONLY source of tenant identity. Never read a user id
      // from req.body, req.query, or req.params to scope data.
      req.user = authService.verifyToken(token);
      next();
    } catch {
      // Expired, tampered, wrong algorithm, wrong issuer: all the same to the client.
      authService.clearAuthCookie(res);
      res.status(401).json({ error: "Authentication required." });
    }
  };
}

module.exports = { createRequireAuth };