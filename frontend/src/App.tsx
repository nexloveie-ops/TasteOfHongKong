import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StoreRouteShell } from './context/StoreContext';
import { CartProvider } from './context/CartContext';
import PlatformLayout from './layouts/PlatformLayout';
import PlatformLoginPage from './pages/platform/PlatformLoginPage';
import PlatformDashboard from './pages/platform/PlatformDashboard';
import LoginPage from './pages/LoginPage';
import CustomerLayout from './layouts/CustomerLayout';
import CashierLayout from './layouts/CashierLayout';
import AdminLayout from './layouts/AdminLayout';
import ScanLanding from './pages/customer/ScanLanding';
import MenuView from './pages/customer/MenuView';
import CartPage from './pages/customer/CartPage';
import OrderStatusPage from './pages/customer/OrderStatusPage';
import CashierOrder from './pages/cashier/CashierOrder';
import ReprintReceipt from './pages/cashier/ReprintReceipt';
import PhoneOrderList from './pages/cashier/PhoneOrderList';
import DineInOrderBoard from './pages/cashier/DineInOrderBoard';
import TakeoutOrderList from './pages/cashier/TakeoutOrderList';
import TakeoutDelivery from './pages/cashier/TakeoutDelivery';
import CheckoutFlow from './pages/cashier/CheckoutFlow';
import CategoryManager from './pages/admin/CategoryManager';
import MenuItemManager from './pages/admin/MenuItemManager';
import OptionGroupTemplates from './pages/admin/OptionGroupTemplates';
import InventoryManager from './pages/admin/InventoryManager';
import AllergenManager from './pages/admin/AllergenManager';
import I18nEditor from './pages/admin/I18nEditor';
import QRCodeManager from './pages/admin/QRCodeManager';
import OrderHistory from './pages/admin/OrderHistory';
import ReportDashboard from './pages/admin/ReportDashboard';
import UserManager from './pages/admin/UserManager';
import SystemConfig from './pages/admin/SystemConfig';
import RestaurantInfo from './pages/admin/RestaurantInfo';
import OfferManager from './pages/admin/OfferManager';
import CouponManager from './pages/admin/CouponManager';
import BusinessHours from './pages/admin/BusinessHours';
import StripeSettings from './pages/admin/StripeSettings';

const DEFAULT_STORE_SLUG = import.meta.env.VITE_DEFAULT_STORE_SLUG || 'demo';

function StoreUnknownRoute() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  return <Navigate to={`/${storeSlug}/login`} replace />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { storeSlug } = useParams<{ storeSlug: string }>();
  if (!isAuthenticated) return <Navigate to={`/${storeSlug}/login`} replace />;
  return <>{children}</>;
}

function RequireOwner({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const { storeSlug } = useParams<{ storeSlug: string }>();
  if (!isAuthenticated) return <Navigate to={`/${storeSlug}/login`} replace />;
  if (user?.role !== 'owner' && user?.role !== 'platform_owner') {
    return <Navigate to={`/${storeSlug}/cashier`} replace />;
  }
  return <>{children}</>;
}

function RequirePlatformAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated || user?.role !== 'platform_owner') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<PlatformLoginPage />} />
          <Route path="/platform" element={<RequirePlatformAuth><PlatformLayout /></RequirePlatformAuth>}>
            <Route index element={<PlatformDashboard />} />
          </Route>

          <Route path="/:storeSlug" element={<StoreRouteShell />}>
            <Route index element={<Navigate to="login" replace />} />
            <Route path="login" element={<LoginPage />} />

            <Route path="customer" element={<CartProvider><CustomerLayout /></CartProvider>}>
              <Route index element={<ScanLanding />} />
              <Route path="menu" element={<MenuView />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="order/:orderId" element={<OrderStatusPage />} />
            </Route>

            <Route path="cashier" element={<RequireAuth><CashierLayout /></RequireAuth>}>
              <Route index element={<DineInOrderBoard />} />
              <Route path="order" element={<CashierOrder />} />
              <Route path="reprint" element={<ReprintReceipt />} />
              <Route path="phone" element={<PhoneOrderList />} />
              <Route path="inventory" element={<InventoryManager />} />
              <Route path="takeout" element={<TakeoutOrderList />} />
              <Route path="delivery" element={<TakeoutDelivery />} />
              <Route path="checkout/:tableNumber" element={<CheckoutFlow />} />
              <Route path="checkout/seat/:orderId" element={<CheckoutFlow />} />
            </Route>

            <Route path="admin" element={<RequireOwner><AdminLayout /></RequireOwner>}>
              <Route index element={<CategoryManager />} />
              <Route path="restaurant" element={<RestaurantInfo />} />
              <Route path="categories" element={<CategoryManager />} />
              <Route path="menu-items" element={<MenuItemManager />} />
              <Route path="option-group-templates" element={<OptionGroupTemplates />} />
              <Route path="inventory" element={<InventoryManager />} />
              <Route path="allergens" element={<AllergenManager />} />
              <Route path="i18n" element={<I18nEditor />} />
              <Route path="qr-codes" element={<QRCodeManager />} />
              <Route path="orders" element={<OrderHistory />} />
              <Route path="reports" element={<ReportDashboard />} />
              <Route path="business-hours" element={<BusinessHours />} />
              <Route path="users" element={<UserManager />} />
              <Route path="config" element={<SystemConfig />} />
              <Route path="stripe" element={<StripeSettings />} />
              <Route path="offers" element={<OfferManager />} />
              <Route path="coupons" element={<CouponManager />} />
            </Route>

            <Route path="*" element={<StoreUnknownRoute />} />
          </Route>

          <Route path="*" element={<Navigate to={`/${DEFAULT_STORE_SLUG}/login`} replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
