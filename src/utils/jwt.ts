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
  const isProd = process.env.NODE_ENV === 'production'
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24, // fallback 1 day (not authoritative)
    secure: isProd,
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  })
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // fallback
    secure: isProd,
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  })
}


