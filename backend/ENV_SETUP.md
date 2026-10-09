# Backend environment setup

Copy `.env.example` to `.env` in the backend directory and restart the server. Preserve existing secrets when updating an existing file.

- `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`: server and browser settings. Native mobile requests do not require CORS origins.
- `JWT_SECRET`, `JWT_EXPIRES_IN`: authentication. Production requires a private JWT secret; development can use a random startup key.
- `MONGODB_URI`, `MONGODB_DB_NAME`: account and design-session persistence. Production requires MongoDB; local development accounts are ephemeral without it.
- `ML_SERVICE_URL`, `ML_TIMEOUT_MS`: private OWLv2/XGBoost inference service (default loopback port 8000).
- `FURNITURE_CATALOG_PATH`: optional client furniture metadata with meter dimensions, model URLs and PHP prices.
- `PEXELS_API_KEY` or `THEME_RECOMMENDATION_API_KEY`: optional inspiration-photo search.
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`: optional error reporting.

Gemini/OpenAI credentials are not required by the converted runtime. Keep provider credentials on the server. See [ML setup and training](../ml-service/README.md).
