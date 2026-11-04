// All queries here are parameterized. Credentials (password_hash) are only ever
// returned by findCredentialsByEmail, and never leave the auth service.
const PUBLIC_COLUMNS = `
  id,
  email,
  full_name AS "fullName",
  created_at AS "createdAt"
`;

function createUserStore(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required to create the user store.");
  }

  // Returns the new user, or null if the email is already registered.
  // ON CONFLICT is race-safe, unlike "SELECT then INSERT".
  async function create({ email, passwordHash, fullName = null }) {
    const result = await pool.query(
      `INSERT INTO public.users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO NOTHING
       RETURNING ${PUBLIC_COLUMNS}`,
      [email, passwordHash, fullName]
    );
    return result.rows[0] || null;
  }

  async function findCredentialsByEmail(email) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS}, password_hash AS "passwordHash"
       FROM public.users
       WHERE lower(email) = lower($1)`,
      [email]
    );
    return result.rows[0] || null;
  }

  async function findById(id) {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM public.users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  return { create, findCredentialsByEmail, findById };
}

module.exports = { createUserStore };