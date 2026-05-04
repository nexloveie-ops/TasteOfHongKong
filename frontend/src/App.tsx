import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Customer routes — no auth, wrapped in CartProvider */}
          <Route path="/customer" element={<CartProvider><CustomerLayout /></CartProvider>}>
            <Route index element={<ScanLanding />} />
            <Route path="menu" element={<MenuView />} />
            <Route path="cart" element={<CartPage />} />
            <Route path="order/:orderId" element={<OrderStatusPage />} />
          </Route>

          {/* Cashier routes — require auth */}
          <Route path="/cashier" element={<RequireAuth><CashierLayout /></RequireAuth>}>
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

          {/* Admin routes — require auth */}
          <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
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
            <Route path="offers" element={<OfferManager />} />
            <Route path="coupons" element={<CouponManager />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
