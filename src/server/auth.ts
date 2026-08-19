import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from './db';
import { config } from './config';

export interface TokenPayload {
  username: string;
  iat?: number;
  exp?: number;
}

export function initAuth() {
  // Check if admin user exists, if not, create default admin from config
  if (!db.hasUsers()) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(config.adminPassword, salt);
    db.saveUser({
      username: config.adminUsername,
      passwordHash: hash,
      createdAt: Date.now(),
    });
    console.log(`[Auth] Initialized default admin user: '${config.adminUsername}'`);
  }
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export function createToken(username: string): string {
  return jwt.sign({ username }, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    return null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  // Check Authorization header or cookie
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if ((req as any).cookies && (req as any).cookies.auth_token) {
    token = (req as any).cookies.auth_token;
  }

  if (!token) {
    reply.status(401).send({ error: 'Unauthorized: No token provided' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload || !db.getUser(payload.username)) {
    reply.status(401).send({ error: 'Unauthorized: Invalid token' });
    return;
  }

  (req as any).user = payload;
}
