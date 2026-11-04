const crypto = require("node:crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { jwtSecret, jwtExpiresIn, cookieSecure } = require("../config/env");

const COOKIE_NAME = "emenoxr_token";
const JWT_ISSUER = "emenoxr";
const JWT_ALGORITHM = "HS256";

// argon2id with the OWASP-recommended minimum parameters (19 MiB, 2 passes, 1 lane).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

class AuthError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

function createAuthService({ users }) {
  if (!users) {
    throw new TypeError("A user store is required to create the auth service.");
  }

  // Used to burn the same CPU time when an email doesn't exist, so response
  // timing doesn't reveal which emails are registered.
  let dummyHashPromise;
  function getDummyHash() {
    dummyHashPromise ??= argon2.hash(crypto.randomBytes(16).toString("hex"), HASH_OPTIONS);
    return dummyHashPromise;
  }

  async function register({ email, password, fullName }) {
    const passwordHash = await argon2.hash(password, HASH_OPTIONS);
    const user = await users.create({ email, passwordHash, fullName });
    if (!user) {
      throw new AuthError("EMAIL_TAKEN", "An account with this email already exists.", 409);
    }
    return user;
  }

  async function authenticate({ email, password }) {
    const record = await users.findCredentialsByEmail(email);
    const hashToCheck = record ? record.passwordHash : await getDummyHash();

    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(hashToCheck, password);
    } catch {
      passwordMatches = false;
    }

    // One generic message for "no such user" and "wrong password".
    if (!record || !passwordMatches) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
    }

    const { passwordHash, ...publicUser } = record;
    return publicUser;
  }

  function signToken(user) {
    return jwt.sign({ email: user.email }, jwtSecret, {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      subject: user.id,
      expiresIn: jwtExpiresIn
    });
  }

  // Returns { id, email } or throws. The algorithm is pinned so a forged
  // token with "alg: none" (or any other algorithm) is rejected.
  function verifyToken(token) {
    const payload = jwt.verify(token, jwtSecret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER
    });
    if (typeof payload.sub !== "string") {
      throw new Error("Token has no subject.");
    }
    return { id: payload.sub, email: payload.email };
  }

  function cookieOptions() {
    return {
      httpOnly: true,          // JavaScript can't read it, which limits XSS damage
      secure: cookieSecure,    // HTTPS only in production
      sameSite: "strict",      // not sent on cross-site requests (CSRF defense)
      path: "/"
    };
  }

  function setAuthCookie(res, token) {
    const { exp } = jwt.decode(token);
    res.cookie(COOKIE_NAME, token, {
      ...cookieOptions(),
      maxAge: Math.max(0, exp * 1000 - Date.now())
    });
  }

  function clearAuthCookie(res) {
    // Attributes must match the ones used when setting the cookie.
    res.clearCookie(COOKIE_NAME, cookieOptions());
  }

  return {
    cookieName: COOKIE_NAME,
    register,
    authenticate,
    signToken,
    verifyToken,
    setAuthCookie,
    clearAuthCookie
  };
}

module.exports = { createAuthService, AuthError };