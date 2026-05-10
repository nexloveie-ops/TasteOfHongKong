import { BrowserRouter, Routes, Route, Navigate, useParams, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { StoreRouteShell } from './context/StoreContext';
import { CartProvider } from './context/CartContext';
import PlatformLayout from './layouts/PlatformLayout';
import PortalHome from './pages/PortalHome';
import PlatformLoginPage from './pages/platform/PlatformLoginPage';
import PlatformStoresPage from './pages/platform/PlatformStoresPage';
import PlatformPostOrderAdsPage from './pages/platform/PlatformPostOrderAdsPage';
import PlatformIntegrationsPage from './pages/platform/PlatformIntegrationsPage';
import LoginPage from './pages/LoginPage';
import CustomerLayout from './layouts/CustomerLayout';
import CashierLayout from './layouts/CashierLayout';
import AdminLayout from './layouts/AdminLayout';
import ScanLanding from './pages/customer/ScanLanding';
import StoreFrontPage from './pages/customer/StoreFrontPage';
import MenuView from './pages/customer/MenuView';
import CartPage from './pages/customer/CartPage';
import OrderStatusPage from './pages/customer/OrderStatusPage';
import MemberPortalPage from './pages/customer/MemberPortalPage';
import CashierOrder from './pages/cashier/CashierOrder';
import ReprintReceipt from './pages/cashier/ReprintReceipt';
import PhoneOrderList from './pages/cashier/PhoneOrderList';
import TakeoutOrderList from './pages/cashier/TakeoutOrderList';
import TakeoutDelivery from './pages/cashier/TakeoutDelivery';
import CheckoutFlow from './pages/cashier/CheckoutFlow';
import UnifiedOrderCenter from './pages/cashier/UnifiedOrderCenter';
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
import DeliveryFeeSettings from './pages/admin/DeliveryFeeSettings';
import OfferManager from './pages/admin/OfferManager';
import CouponManager from './pages/admin/CouponManager';
import MemberManager from './pages/admin/MemberManager';
import BusinessHours from './pages/admin/BusinessHours';
import StripeSettings from './pages/admin/StripeSettings';

const DEFAULT_STORE_SLUG = import.meta.env.VITE_DEFAULT_STORE_SLUG || 'demo';

function StoreUnknownRoute() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  return <Navigate to={`/${storeSlug}`} replace />;
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
    return <Navigate to="/adlg" replace />;
  }
  return <>{children}</>;
}

function RequireFeature({ featureKey, children }: { featureKey: string; children: React.ReactNode }) {
  const { hasFeature } = useAuth();
  const { storeSlug } = useParams<{ storeSlug: string }>();
  if (!hasFeature(featureKey)) {
    return <Navigate to={`/${storeSlug}/admin`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<PortalHome />} />
          <Route path="/adlg" element={<PlatformLoginPage />} />
          <Route path="/platform" element={<RequirePlatformAuth><PlatformLayout /></RequirePlatformAuth>}>
            <Route index element={<Navigate to="stores" replace />} />
            <Route path="stores" element={<PlatformStoresPage />} />
            <Route path="ads" element={<PlatformPostOrderAdsPage />} />
            <Route path="integrations" element={<PlatformIntegrationsPage />} />
          </Route>

          <Route path="/:storeSlug" element={<StoreRouteShell />}>
            <Route path="login" element={<LoginPage />} />

            <Route element={<CartProvider><CustomerLayout /></CartProvider>}>
              <Route index element={<StoreFrontPage />} />
              <Route path="customer" element={<Outlet />}>
                <Route index element={<ScanLanding />} />
                {/* Same compact hero / offer strip as storefront ?type=takeout|delivery (storeFrontEmbed) */}
                <Route path="menu" element={<MenuView storeFrontEmbed />} />
                <Route path="cart" element={<CartPage />} />
                <Route path="order/:orderId" element={<OrderStatusPage />} />
                <Route path="member" element={<MemberPortalPage />} />
              </Route>
            </Route>

            <Route path="cashier" element={<RequireAuth><CashierLayout /></RequireAuth>}>
              <Route index element={<UnifiedOrderCenter />} />
              <Route path="orders" element={<UnifiedOrderCenter />} />
              {/* Legacy pages kept for rollback */}
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
              <Route path="delivery-fees" element={<RequireFeature featureKey="cashier.delivery.page"><DeliveryFeeSettings /></RequireFeature>} />
              <Route path="categories" element={<CategoryManager />} />
              <Route path="menu-items" element={<MenuItemManager />} />
              <Route path="option-group-templates" element={<RequireFeature featureKey="admin.optionGroupTemplates.page"><OptionGroupTemplates /></RequireFeature>} />
              <Route path="inventory" element={<InventoryManager />} />
              <Route path="allergens" element={<AllergenManager />} />
              <Route path="i18n" element={<I18nEditor />} />
              <Route path="qr-codes" element={<QRCodeManager />} />
              <Route path="orders" element={<RequireFeature featureKey="admin.orderHistory.page"><OrderHistory /></RequireFeature>} />
              <Route path="reports" element={<ReportDashboard />} />
              <Route path="business-hours" element={<BusinessHours />} />
              <Route path="users" element={<UserManager />} />
              <Route path="config" element={<SystemConfig />} />
              <Route path="stripe" element={<StripeSettings />} />
              <Route path="offers" element={<RequireFeature featureKey="admin.offers.page"><OfferManager /></RequireFeature>} />
              <Route path="coupons" element={<RequireFeature featureKey="admin.coupons.page"><CouponManager /></RequireFeature>} />
              <Route path="members" element={<RequireFeature featureKey="cashier.member.wallet"><MemberManager /></RequireFeature>} />
            </Route>

            <Route path="*" element={<StoreUnknownRoute />} />
          </Route>

          <Route path="*" element={<Navigate to={`/${DEFAULT_STORE_SLUG}`} replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
