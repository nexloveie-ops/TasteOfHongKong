export enum Role {
  OWNER = 'owner',
  CASHIER = 'cashier',
}

export const rolePermissions: Record<Role, string[]> = {
  [Role.OWNER]: ['menu:*', 'order:*', 'checkout:*', 'report:*', 'admin:*', 'config:*'],
  [Role.CASHIER]: ['order:read', 'checkout:*', 'receipt:print', 'takeout:complete', 'menu:sold-out', 'report:view'],
};

/**
 * Check if a role has a specific permission.
 * Supports wildcard matching: 'menu:*' grants 'menu:read', 'menu:write', etc.
 * An exact match also works: 'order:read' grants 'order:read'.
 */
export function hasPermission(role: Role, permission: string): boolean {
  const perms = rolePermissions[role];
  if (!perms) return false;

  return perms.some((p) => {
    if (p === permission) return true;
    // Wildcard: 'menu:*' matches any 'menu:xxx'
    if (p.endsWith(':*')) {
      const prefix = p.slice(0, -1); // 'menu:'
      return permission.startsWith(prefix);
    }
    return false;
  });
}
