import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Store } from "../../../packages/storage/src/index.js";

type AuthConfig = {
  domain: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  appOrigin: string;
  connection: string;
  secret: string;
};
type Profile = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};
type Session = {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: number;
  profile: Profile;
};
type TokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
};

const sessionCookie = "unfold_session";
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const cookieValue = (req: Request, name: string) => {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createAuth(store: Store) {
  const sessionSecret =
    process.env.AUTH0_SESSION_SECRET || process.env.AUTH0_SECRET || "";
  const audience = process.env.AUTH0_AUDIENCE || "";
  const domain = (process.env.AUTH0_DOMAIN || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const appOrigin =
    process.env.APP_ORIGIN ||
    process.env.APP_BASE_URL ||
    (process.env.RENDER_EXTERNAL_HOSTNAME
      ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
      : undefined) ||
    `http://127.0.0.1:${process.env.PORT || 4310}`;
  let validOrigin = false;
  try {
    validOrigin = new URL(appOrigin).origin === appOrigin;
  } catch {
    // The configuration status endpoint stays available so setup can be corrected.
  }
  const config: AuthConfig | undefined =
    domain &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET &&
    sessionSecret.length >= 32 &&
    validOrigin
      ? {
          domain,
          clientId: process.env.AUTH0_CLIENT_ID,
          clientSecret: process.env.AUTH0_CLIENT_SECRET,
          audience: audience || undefined,
          appOrigin,
          connection:
            process.env.AUTH0_CONNECTION || "Username-Password-Authentication",
          secret: sessionSecret,
        }
      : undefined;
  const issuer = config ? `https://${config.domain}/` : "";
  const jwks = config
    ? createRemoteJWKSet(
        new URL(`https://${config.domain}/.well-known/jwks.json`),
      )
    : undefined;
  const encryptionKey = config
    ? scryptSync(config.secret, `unfold-auth:${config.domain}`, 32)
    : undefined;
  const resetAttempts = new Map<string, { count: number; resetAt: number }>();
  const refreshes = new Map<string, Promise<Session>>();
  store.clearExpiredAuthState();

  const seal = (value: unknown) => {
    if (!encryptionKey) throw new Error("Auth encryption is not configured");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString("base64url"))
      .join(".");
  };
  const unseal = <T>(value: string): T => {
    if (!encryptionKey) throw new Error("Auth encryption is not configured");
    const [ivValue, tagValue, ciphertextValue] = value.split(".");
    if (!ivValue || !tagValue || !ciphertextValue)
      throw new Error("Invalid encrypted auth value");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  };
  const setCookie = (res: Response, value: string, maxAge: number) => {
    const secure = config?.appOrigin.startsWith("https://") ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${sessionCookie}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}${secure}`,
    );
  };
  const clearCookie = (res: Response) => {
    const secure = config?.appOrigin.startsWith("https://") ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    );
  };
  const verifyAccessToken = async (token: string) => {
    if (!config || !jwks || !config.audience)
      throw new Error("An Auth0 API audience is required for access tokens");
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    });
    if (typeof payload.sub !== "string")
      throw new Error("Access token has no user subject");
    return payload;
  };
  const refreshSession = async (
    sessionHash: string,
    session: Session,
  ): Promise<Session> => {
    if (!config || !session.refreshToken)
      throw new Error("Authentication session expired");
    const response = await fetch(`https://${config.domain}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: session.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Authentication session expired");
    const tokens = (await response.json()) as TokenResponse;
    const identity = await verifyAccessToken(tokens.access_token);
    if (identity.sub !== session.profile.sub)
      throw new Error("Refreshed access token subject mismatch");
    const refreshed: Session = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || session.refreshToken,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    };
    store.saveAuthSession(
      sessionHash,
      session.profile.sub,
      seal(refreshed),
      Date.now() + sessionLifetimeMs,
    );
    return refreshed;
  };
  const getSession = async (sessionHash: string) => {
    if (!config) throw new Error("Authentication is not configured");
    const row = store.authSession(sessionHash);
    if (!row || row.expires_at <= Date.now()) {
      store.deleteAuthSession(sessionHash);
      throw new Error("Authentication required");
    }
    let session = unseal<Session>(row.data);
    if (config.audience && session.accessExpiresAt <= Date.now() + 60_000) {
      let refreshing = refreshes.get(sessionHash);
      if (!refreshing) {
        refreshing = refreshSession(sessionHash, session).finally(() =>
          refreshes.delete(sessionHash),
        );
        refreshes.set(sessionHash, refreshing);
      }
      session = await refreshing;
    }
    if (row.user_id !== session.profile.sub)
      throw new Error("Authentication session subject mismatch");
    if (config.audience) {
      const payload = await verifyAccessToken(session.accessToken);
      if (payload.sub !== row.user_id)
        throw new Error("Authentication session subject mismatch");
    }
    return session;
  };
  const requireAuth: RequestHandler = (req, res, next) => {
    void (async () => {
      if (!config) {
        res.status(503).json({ error: "auth0_not_configured" });
        return;
      }
      const authorization = req.get("authorization") || "";
      const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (bearer) {
        const payload = await verifyAccessToken(bearer);
        if (typeof payload.sub !== "string")
          throw new Error("Access token has no user subject");
        res.locals.authUser = { sub: payload.sub } satisfies Profile;
        next();
        return;
      }
      const sessionId = cookieValue(req, sessionCookie);
      if (!sessionId) {
        res.status(401).json({ error: "authentication_required" });
        return;
      }
      const sessionHash = hash(sessionId);
      try {
        const session = await getSession(sessionHash);
        res.locals.authUser = session.profile satisfies Profile;
        next();
      } catch {
        store.deleteAuthSession(sessionHash);
        clearCookie(res);
        res.status(401).json({ error: "authentication_required" });
      }
    })().catch(() => {
      res.status(401).json({ error: "invalid_access_token" });
    });
  };

  const status: RequestHandler = (_req, res) =>
    res.json({ configured: Boolean(config) });

  const login: RequestHandler = (req, res) => {
    if (!config) {
      res
        .status(503)
        .send(
          "Auth0 is not configured. Add the AUTH0_* settings and restart Unfold.",
        );
      return;
    }
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const returnTo = (() => {
      try {
        const target = new URL(
          String(req.query.returnTo || "/"),
          config.appOrigin,
        );
        return target.origin === config.appOrigin
          ? `${target.pathname}${target.search}${target.hash}`
          : "/";
      } catch {
        return "/";
      }
    })();
    store.clearExpiredAuthState();
    store.saveAuthTransaction(
      hash(state),
      seal({ state, nonce, verifier, returnTo }),
      Date.now() + 5 * 60_000,
    );
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL(`https://${config.domain}/authorize`);
    const authorizeParams = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: `${config.appOrigin}/auth/callback`,
      scope: "openid profile email offline_access",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(req.query.mode === "signup" ? { screen_hint: "signup" } : {}),
    });
    if (config.audience) authorizeParams.set("audience", config.audience);
    authorize.search = authorizeParams.toString();
    res.redirect(302, authorize.toString());
  };

  const callback: RequestHandler = (req, res) => {
    void (async () => {
      if (!config || !jwks || !encryptionKey) {
        res.status(503).send("Auth0 is not configured.");
        return;
      }
      if (req.query.error) {
        res.redirect(302, config.appOrigin);
        return;
      }
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) {
        res
          .status(400)
          .send("The sign-in response was incomplete. Please try again.");
        return;
      }
      const encryptedTransaction = store.consumeAuthTransaction(hash(state));
      if (!encryptedTransaction) {
        res.status(400).send("The sign-in session expired. Please try again.");
        return;
      }
      const transaction = unseal<{
        state: string;
        nonce: string;
        verifier: string;
        returnTo: string;
      }>(encryptedTransaction);
      if (!equal(transaction.state, state)) {
        res.status(400).send("The sign-in response could not be verified.");
        return;
      }
      const tokenResponse = await fetch(
        `https://${config.domain}/oauth/token`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: `${config.appOrigin}/auth/callback`,
            code_verifier: transaction.verifier,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!tokenResponse.ok) {
        res.redirect(302, `${config.appOrigin}?auth_error=exchange`);
        return;
      }
      const tokens = (await tokenResponse.json()) as TokenResponse;
      if (!tokens.id_token || !tokens.access_token || !tokens.expires_in)
        throw new Error("Auth0 did not return the required tokens");
      const { payload: identity } = await jwtVerify(tokens.id_token, jwks, {
        issuer,
        audience: config.clientId,
        algorithms: ["RS256"],
      });
      if (
        typeof identity.sub !== "string" ||
        typeof identity.nonce !== "string" ||
        !equal(identity.nonce, transaction.nonce)
      )
        throw new Error("Auth0 identity could not be verified");
      if (config.audience) {
        const accessIdentity = await verifyAccessToken(tokens.access_token);
        if (accessIdentity.sub !== identity.sub)
          throw new Error("Auth0 token subjects do not match");
      }
      const profile: Profile = {
        sub: identity.sub,
        email: typeof identity.email === "string" ? identity.email : undefined,
        name: typeof identity.name === "string" ? identity.name : undefined,
        picture:
          typeof identity.picture === "string" ? identity.picture : undefined,
      };
      const sessionId = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + sessionLifetimeMs;
      const session: Session = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessExpiresAt: Date.now() + tokens.expires_in * 1000,
        profile,
      };
      store.saveAuthSession(
        hash(sessionId),
        profile.sub,
        seal(session),
        expiresAt,
      );
      setCookie(res, sessionId, sessionLifetimeMs);
      res.redirect(302, `${config.appOrigin}${transaction.returnTo}`);
    })().catch((error: unknown) => {
      console.error(
        "Auth0 callback failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      if (config) res.redirect(302, `${config.appOrigin}?auth_error=login`);
      else res.status(503).send("Auth0 is not configured.");
    });
  };

  const me: RequestHandler = (_req, res) =>
    res.json({ user: res.locals.authUser as Profile });

  const logout: RequestHandler = (req, res) => {
    const sessionId = cookieValue(req, sessionCookie);
    if (sessionId) store.deleteAuthSession(hash(sessionId));
    clearCookie(res);
    if (!config) {
      res.redirect(302, appOrigin);
      return;
    }
    const url = new URL(`https://${config.domain}/v2/logout`);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      returnTo: config.appOrigin,
    }).toString();
    res.redirect(302, url.toString());
  };

  const forgotPassword: RequestHandler = (req, res) => {
    void (async () => {
      const generic = {
        message:
          "If an account matches that email, Auth0 will send a password reset link.",
      };
      if (!config) {
        res.status(503).json({ error: "auth0_not_configured" });
        return;
      }
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const current = resetAttempts.get(ip);
      if (current && current.resetAt > now && current.count >= 5) {
        res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
        res.status(429).json(generic);
        return;
      }
      const attempt =
        current && current.resetAt > now
          ? { ...current, count: current.count + 1 }
          : { count: 1, resetAt: now + 15 * 60_000 };
      resetAttempts.set(ip, attempt);
      if (resetAttempts.size > 10_000) {
        for (const [key, value] of resetAttempts)
          if (value.resetAt <= now) resetAttempts.delete(key);
        if (resetAttempts.size > 10_000)
          resetAttempts.delete(resetAttempts.keys().next().value!);
      }
      const email =
        typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (
        !email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        res.status(200).json(generic);
        return;
      }
      try {
        await fetch(`https://${config.domain}/dbconnections/change_password`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: config.clientId,
            email,
            connection: config.connection,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Keep the response indistinguishable so the endpoint cannot reveal account state.
      }
      res.status(200).json(generic);
    })().catch(() =>
      res.status(200).json({
        message:
          "If an account matches that email, Auth0 will send a password reset link.",
      }),
    );
  };

  return { status, login, callback, me, logout, forgotPassword, requireAuth };
}
