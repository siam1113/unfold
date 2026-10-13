# Auth0 setup

Unfold uses an Auth0 Regular Web Application with the Authorization Code flow and PKCE. Credentials stay on the server. Auth0 Universal Login handles passwords, account creation, and password reset emails.

1. Create a **Regular Web Application** in Auth0.
2. Add the app origin to **Allowed Web Origins** and **Allowed Logout URLs**. For the local app, use `http://127.0.0.1:4310`.
3. Add `${APP_BASE_URL}/auth/callback` to **Allowed Callback URLs**. Locally, use `http://127.0.0.1:4310/auth/callback`.
4. If Unfold needs JWT access tokens for a custom API, create an Auth0 API, set its identifier as `AUTH0_AUDIENCE`, and enable the API's offline access grant. This is optional for regular app sign-in.
5. Enable a database connection with sign-up enabled. Configure that connection's password reset email. Set `AUTH0_CONNECTION` to its exact name if it is not `Username-Password-Authentication`.
6. Add the Auth0-provided `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_CLIENT_SECRET` values to `.env.local`. Generate `AUTH0_SECRET` with `openssl rand -hex 32`, and set `APP_BASE_URL` to the browser-facing origin. Docker Compose and the local server scripts load `.env.local`.
7. Add `${APP_BASE_URL}` to **Allowed Logout URLs** and **Allowed Web Origins**. Use the public HTTPS origin in production. Restart the server after changing environment values.

The server encrypts Auth0 tokens in SQLite and gives the browser only a random HttpOnly, SameSite cookie. Project and discovery queries are filtered by the verified Auth0 subject. Keep the SQLite database and session secret private; changing the session secret invalidates existing sessions.

Auth0 references: [Regular Web Application setup](https://auth0.com/docs/get-started/auth0-overview/create-applications/regular-web-apps), [Authorization Code flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow/add-login-auth-code-flow), [Universal Login](https://auth0.com/docs/authenticate/login/auth0-universal-login/universal-login-vs-classic-login/universal-experience), and [password reset endpoint](https://sus.auth0.com/docs/api/authentication/change-password/change-password).
