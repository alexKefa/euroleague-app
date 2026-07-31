import jwt from "jsonwebtoken";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

const ACCESS_SECRET = requireEnv("JWT_ACCESS_SECRET");
const REFRESH_SECRET = requireEnv("JWT_REFRESH_SECRET");
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? "15m";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? "30d";

export interface TokenPayload {
  sub: string; // user id
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies TokenPayload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies TokenPayload, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as TokenPayload;
}