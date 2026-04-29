import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createAppError } from './errorHandler';
import { hasPermission, Role } from './permissions';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';

export interface JwtPayload {
  userId: string;
  username: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function getJwtSecret(): string {
  return JWT_SECRET;
}

/**
 * Middleware that verifies the JWT token from the Authorization header.
 * Attaches the decoded user payload to req.user.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createAppError('UNAUTHORIZED', 'Missing or invalid authorization token');
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    throw createAppError('UNAUTHORIZED', 'Invalid or expired token');
  }
}

/**
 * Middleware factory that checks if the authenticated user has the required permission.
 * Must be used after authMiddleware.
 */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw createAppError('UNAUTHORIZED', 'Authentication required');
    }

    if (!hasPermission(req.user.role as Role, permission)) {
      throw createAppError('FORBIDDEN', 'Insufficient permissions');
    }

    next();
  };
}
