# Local development accounts

When MongoDB is unavailable outside production, signup and login use an ephemeral in-memory account store. Create an account through `POST /api/v1/users/signup`; there are no built-in accounts or default passwords. Passwords are bcrypt hashes. Accounts disappear when the server restarts.

Production disables local accounts and requires MongoDB plus a private `JWT_SECRET`. Outside production, an unconfigured JWT secret is randomly generated at startup, so tokens expire on restart. Configure `JWT_SECRET` to keep a stable signing key.

Tokens are signed and verified by `jsonwebtoken` using HS256. Supply a token through `Authorization: Bearer <token>` or `X-API-Key`. Protected routes require authentication in development too; invalid tokens never fall back to unsigned payload decoding.

Run the focused signup, login and authentication regression checks with `npm run test:auth` from the backend directory.