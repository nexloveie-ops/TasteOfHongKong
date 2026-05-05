import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from './auth';
import { createAppError } from './errorHandler';

export function requirePlatformOwner(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'platform_owner') {
    next(createAppError('FORBIDDEN', '仅平台管理员可访问'));
    return;
  }
  next();
}

/** JWT 校验 + platform_owner */
export const platformAuth = [authMiddleware, requirePlatformOwner];
