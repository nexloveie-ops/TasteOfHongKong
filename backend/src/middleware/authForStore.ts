import { authMiddleware } from './auth';
import { enforceJwtStoreMatch } from './storeContext';

/** 已登录且 JWT.storeId 与当前 X-Store-Slug 解析的店铺一致（platform_owner 除外） */
export const requireAuthSameStore = [authMiddleware, enforceJwtStoreMatch];
