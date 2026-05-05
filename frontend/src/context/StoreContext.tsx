import { createContext, useContext, type ReactNode } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { configureApiClient } from '../api/client';

const StoreContext = createContext<{ slug: string } | null>(null);

export function useStoreSlug(): string {
  const ctx = useContext(StoreContext);
  if (!ctx?.slug) throw new Error('useStoreSlug must be used under /:storeSlug');
  return ctx.slug;
}

function ApiConfigSync({ children }: { children: ReactNode }) {
  const ctx = useContext(StoreContext);
  const slug = ctx?.slug ?? '';
  const { token } = useAuth();
  /** 必须在 render 同步执行：子组件 useEffect 里的 apiFetch 会在任何 effect 之前排队，不能在 useLayoutEffect 里才写入 slug。 */
  configureApiClient(() => slug, () => token);
  return <>{children}</>;
}

export function StoreRouteShell() {
  const { storeSlug = '' } = useParams<{ storeSlug: string }>();
  return (
    <StoreContext.Provider value={{ slug: storeSlug }}>
      <ApiConfigSync>
        <Outlet />
      </ApiConfigSync>
    </StoreContext.Provider>
  );
}
