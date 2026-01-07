import jwt, { SignOptions } from 'jsonwebtoken'
import { Response } from 'express'
import dotenv from 'dotenv'
dotenv.config()

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access_secret'
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refresh_secret'

export const signAccessToken = (payload: object) => {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRES || '15m' } as SignOptions )
}

export const signRefreshToken = (payload: object) => {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES || '7d' } as SignOptions)
}

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, ACCESS_SECRET)
}

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, REFRESH_SECRET)
}

export const attachTokens = (res: Response, accessToken: string, refreshToken: string) => {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  
  const cookieOptions = {
    httpOnly: true,
    secure: true, // Always true for Render/HTTPS
    sameSite: 'none' as const, // Required for cross-site cookies
    domain: process.env.COOKIE_DOMAIN || undefined,
  };

  res.cookie('access_token', accessToken, {
    ...cookieOptions,
    maxAge: 1000 * 60 * 15, // 15 minutes to match JWT expiration
  })
  
  res.cookie('refresh_token', refreshToken, {
    ...cookieOptions,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  })
}


