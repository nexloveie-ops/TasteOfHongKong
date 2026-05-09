import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createAppError } from './errorHandler';
import { getJwtSecret } from './auth';

export type MemberJwtPayload = {
  typ: 'member';
  memberId: string;
  storeId: string;
};

declare global {
  namespace Express {
    interface Request {
      memberAuth?: MemberJwtPayload;
    }
  }
}

export function signMemberToken(memberId: string, storeId: string): string {
  return jwt.sign({ typ: 'member', memberId, storeId }, getJwtSecret(), { expiresIn: '7d' });
}

export function memberAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(createAppError('UNAUTHORIZED', 'Missing or invalid authorization token'));
    return;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as MemberJwtPayload;
    if (decoded.typ !== 'member' || !decoded.memberId || !decoded.storeId) {
      next(createAppError('UNAUTHORIZED', 'Invalid member token'));
      return;
    }
    if (req.storeId && decoded.storeId !== req.storeId.toString()) {
      next(createAppError('FORBIDDEN', '店铺不匹配'));
      return;
    }
    req.memberAuth = decoded;
    next();
  } catch {
    next(createAppError('UNAUTHORIZED', 'Invalid or expired token'));
  }
}
