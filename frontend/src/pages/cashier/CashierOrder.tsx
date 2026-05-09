import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import OptionSelectModal, { type OptionGroup } from '../../components/customer/OptionSelectModal';
import type { CartItemOption } from '../../context/CartContext';
import ReceiptPrint from '../../components/cashier/ReceiptPrint';
import { buildReceiptHTML, printViaIframe } from '../../components/cashier/ReceiptPrint';
import { matchBundles, calcBundleTotal, type OfferData, type MatchedBundle } from '../../utils/bundleMatcher';
import {
  DELIVERY_FEE_RULES_CONFIG_KEY,
  deliveryFeeForDistance,
  parseDeliveryFeeRulesJson,
  type DeliveryFeeTier,
} from '../../utils/deliveryFeeRules';
import { apiFetch } from '../../api/client';
import CashierMemberCheckoutBlock, {
  buildMemberFullWalletCheckoutBody,
  canMemberFullWalletPay,
  type CashierMemberPreview,
} from '../../components/cashier/CashierMemberCheckoutBlock';

interface Translation { locale: string; name: string; description?: string; }
interface Category { _id: string; sortOrder: number; translations: Translation[]; }
interface MenuItem {
  _id: string; categoryId: string; price: number;
  translations: Translation[];
  optionGroups?: OptionGroup[];
  isSoldOut?: boolean;
}
interface OrderItemOption {
  groupId?: string;
  choiceId?: string;
  groupName: Record<string, string>;
  choiceName: Record<string, string>;
  extraPrice: number;
}
interface OrderLine {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  options?: OrderItemOption[];
}

let lineIdCounter = 0;
function nextLineId() { return `line-${++lineIdCounter}-${Date.now()}`; }

const FREQUENT_LOOKBACK_DAYS = 60;
const FREQUENT_ITEMS_LIMIT = 8;

interface FrequentItemRow {
  menuItemId: string;
  itemName: string;
  itemNameEn: string;
  orderCount: number;
}

export default function CashierOrder() {
  const { t, i18n } = useTranslation();
  const { token, hasFeature } = useAuth();
  const canDelivery = hasFeature('cashier.delivery.page');
  const canMemberWallet = hasFeature('cashier.member.wallet');
  const lang = i18n.language;

  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState('');
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<OrderLine[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeout' | 'phone' | 'delivery'>('dine_in');
  const [deliveryCustomerName, setDeliveryCustomerName] = useState('');
  const [deliveryCustomerPhone, setDeliveryCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('');
  const [deliveryFeeRules, setDeliveryFeeRules] = useState<DeliveryFeeTier[]>([]);
  const [deliveryGeoLoading, setDeliveryGeoLoading] = useState(false);
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [deliveryGeoError, setDeliveryGeoError] = useState('');
  const [deliveryCustomerProfileId, setDeliveryCustomerProfileId] = useState('');
  const [deliveryProfiles, setDeliveryProfiles] = useState<
    { _id: string; customerName: string; deliveryAddress: string; postalCode: string }[]
  >([]);
  const eircodeReqRef = useRef(0);
  /** 会员资料填充邮编后，下一次邮编解析只更新距离，不覆盖详细地址 */
  const skipNextGeoAddressFillRef = useRef(false);
  const memberDeliveryLookupReqRef = useRef(0);
  const deliveryPhoneRef = useRef('');
  /** 命中会员后折叠送餐客户表单，仅显示摘要与地图信息 */
  const [deliveryCustomerCollapsed, setDeliveryCustomerCollapsed] = useState(false);
  const frequentFetchGenRef = useRef(0);
  const [frequentItems, setFrequentItems] = useState<FrequentItemRow[]>([]);
  const [frequentItemsLoading, setFrequentItemsLoading] = useState(false);
  const [frequentItemsExpanded, setFrequentItemsExpanded] = useState(false);
  const [phoneCustomerPhone, setPhoneCustomerPhone] = useState('');
  const [error, setError] = useState('');
  const [optionModal, setOptionModal] = useState<MenuItem | null>(null);

  // Payment modal state
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mixed' | 'member'>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [mixedCash, setMixedCash] = useState('');
  const [mixedCard, setMixedCard] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberPreview, setMemberPreview] = useState<CashierMemberPreview | null>(null);
  const [payingTotal, setPayingTotal] = useState(0);
  const [paying, setPaying] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<{ name: string; nameEn: string; amount: number } | null>(null);
  const [availableCoupons, setAvailableCoupons] = useState<{ _id: string; name: string; nameEn: string; amount: number }[]>([]);

  // Receipt state
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [checkoutMeta, setCheckoutMeta] = useState<{ total: number; cashReceived: number; change: number } | null>(null);
  const [receiptBundleDiscounts, setReceiptBundleDiscounts] = useState<{ name: string; nameEn: string; discount: number }[]>([]);
  const [phoneOrderId, setPhoneOrderId] = useState<string | null>(null);
  const [offers, setOffers] = useState<OfferData[]>([]);

  useEffect(() => {
    if (!canMemberWallet && paymentMethod === 'member') {
      setPaymentMethod('cash');
      setMemberPreview(null);
    }
  }, [canMemberWallet, paymentMethod]);

  const fetchData = useCallback(async () => {
    const [catRes, itemRes, offersRes, couponsRes] = await Promise.all([
      apiFetch(`/api/menu/categories?lang=${lang}`),
      apiFetch('/api/menu/items'),
      apiFetch('/api/offers'),
      apiFetch('/api/coupons'),
    ]);
    if (catRes.ok) {
      const cats: Category[] = await catRes.json();
      setCategories(cats);
      if (cats.length > 0 && !activeCat) setActiveCat(cats[0]._id);
    }
    if (itemRes.ok) setMenuItems(await itemRes.json());
    if (offersRes.ok) setOffers(await offersRes.json());
    if (couponsRes.ok) setAvailableCoupons(await couponsRes.json());
  }, [lang]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (orderType !== 'delivery' || !token) {
      setDeliveryProfiles([]);
      return;
    }
    const phone = deliveryCustomerPhone.trim();
    if (phone.length < 5) {
      setDeliveryProfiles([]);
      return;
    }
    const tmr = setTimeout(() => {
      void apiFetch(`/api/orders/customer-profiles?phone=${encodeURIComponent(phone)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((list: unknown) => {
          setDeliveryProfiles(Array.isArray(list) ? (list as typeof deliveryProfiles) : []);
        })
        .catch(() => setDeliveryProfiles([]));
    }, 400);
    return () => clearTimeout(tmr);
  }, [orderType, deliveryCustomerPhone, token]);

  useEffect(() => {
    deliveryPhoneRef.current = deliveryCustomerPhone;
  }, [deliveryCustomerPhone]);

  useEffect(() => {
    if (!token || !canDelivery) {
      setDeliveryFeeRules([]);
      return;
    }
    let cancelled = false;
    void apiFetch('/api/admin/config', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : {}))
      .then((d: Record<string, string>) => {
        if (cancelled) return;
        const raw = d[DELIVERY_FEE_RULES_CONFIG_KEY];
        setDeliveryFeeRules(typeof raw === 'string' ? parseDeliveryFeeRulesJson(raw) : []);
      })
      .catch(() => {
        if (!cancelled) setDeliveryFeeRules([]);
      });
    return () => { cancelled = true; };
  }, [token, canDelivery]);

  const lookupEircode = useCallback(async (raw: string) => {
    const norm = raw.toUpperCase().replace(/[\s-]/g, '');
    if (norm.length !== 7 || !/^[A-Z][0-9][0-9W][0-9A-Z]{4}$/.test(norm)) {
      skipNextGeoAddressFillRef.current = false;
      setDeliveryDistanceKm(null);
      setDeliveryGeoError('');
      setDeliveryGeoLoading(false);
      return;
    }
    const preserveAddress = skipNextGeoAddressFillRef.current;
    if (preserveAddress) skipNextGeoAddressFillRef.current = false;
    const id = ++eircodeReqRef.current;
    setDeliveryGeoLoading(true);
    setDeliveryGeoError('');
    try {
      const codeParam = `${norm.slice(0, 3)} ${norm.slice(3)}`;
      const res = await apiFetch(`/api/geo/eircode?code=${encodeURIComponent(codeParam)}`);
      const data = (await res.json().catch(() => null)) as { formattedAddress?: string; distanceKm?: number; error?: { message?: string } } | null;
      if (id !== eircodeReqRef.current) return;
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (!preserveAddress) {
        setDeliveryAddress(data?.formattedAddress || '');
      }
      setDeliveryDistanceKm(typeof data?.distanceKm === 'number' ? data.distanceKm : null);
    } catch (e) {
      if (id !== eircodeReqRef.current) return;
      setDeliveryDistanceKm(null);
      setDeliveryGeoError(e instanceof Error ? e.message : t('cashier.geoLookupErrorFallback'));
    } finally {
      if (id === eircodeReqRef.current) setDeliveryGeoLoading(false);
    }
  }, [t]);

  const runMemberDeliveryLookup = useCallback(async (phoneRaw?: string) => {
    if (orderType !== 'delivery' || !token) return;
    const raw = phoneRaw ?? deliveryPhoneRef.current;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8) return;
    const id = ++memberDeliveryLookupReqRef.current;
    try {
      const res = await apiFetch(`/api/members/delivery-lookup?phone=${encodeURIComponent(raw.trim() || digits)}`);
      const data = (res.ok ? await res.json().catch(() => null) : null) as {
        _id?: string;
        displayName?: string;
        deliveryAddress?: string;
        postalCode?: string;
      } | null;
      if (id !== memberDeliveryLookupReqRef.current) return;
      if (deliveryPhoneRef.current.replace(/\D/g, '') !== digits) return;
      if (!data?._id) return;
      skipNextGeoAddressFillRef.current = true;
      setDeliveryCustomerName(String(data.displayName || '').trim());
      setDeliveryPostalCode(String(data.postalCode || '').trim());
      setDeliveryAddress(String(data.deliveryAddress || '').trim());
      setDeliveryCustomerCollapsed(true);
    } catch {
      /* ignore */
    }
  }, [orderType, token]);

  /** 输入足够位数后自动查会员（不依赖离焦，避免 ref 与受控值不同步） */
  useEffect(() => {
    if (orderType !== 'delivery' || !token) return;
    const digits = deliveryCustomerPhone.replace(/\D/g, '');
    if (digits.length < 10) return;
    const t = window.setTimeout(() => {
      void runMemberDeliveryLookup(deliveryPhoneRef.current);
    }, 450);
    return () => window.clearTimeout(t);
  }, [orderType, token, deliveryCustomerPhone, runMemberDeliveryLookup]);

  useEffect(() => {
    if (orderType !== 'delivery') {
      setDeliveryCustomerCollapsed(false);
      setFrequentItems([]);
      setFrequentItemsExpanded(false);
    }
  }, [orderType]);

  useEffect(() => {
    if (orderType !== 'delivery' || !token || !canDelivery) {
      setFrequentItems([]);
      setFrequentItemsLoading(false);
      return;
    }
    if (!deliveryCustomerCollapsed) {
      setFrequentItems([]);
      setFrequentItemsLoading(false);
      return;
    }
    if (!frequentItemsExpanded) {
      return;
    }
    const digits = deliveryCustomerPhone.replace(/\D/g, '');
    if (digits.length < 8) {
      setFrequentItems([]);
      setFrequentItemsLoading(false);
      return;
    }
    const gen = ++frequentFetchGenRef.current;
    setFrequentItemsLoading(true);
    const phoneQ = encodeURIComponent(deliveryCustomerPhone.trim());
    void apiFetch(
      `/api/orders/customer-frequent-items?phone=${phoneQ}&days=${FREQUENT_LOOKBACK_DAYS}&limit=${FREQUENT_ITEMS_LIMIT}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => {
        if (gen !== frequentFetchGenRef.current) return;
        setFrequentItems(Array.isArray(list) ? (list as FrequentItemRow[]) : []);
      })
      .catch(() => {
        if (gen !== frequentFetchGenRef.current) return;
        setFrequentItems([]);
      })
      .finally(() => {
        if (gen !== frequentFetchGenRef.current) return;
        setFrequentItemsLoading(false);
      });
  }, [orderType, deliveryCustomerCollapsed, deliveryCustomerPhone, frequentItemsExpanded, token, canDelivery]);

  useEffect(() => {
    if (orderType !== 'delivery' || !canDelivery) {
      setDeliveryDistanceKm(null);
      setDeliveryGeoError('');
      setDeliveryGeoLoading(false);
      return;
    }
    const t = window.setTimeout(() => {
      void lookupEircode(deliveryPostalCode);
    }, 500);
    return () => window.clearTimeout(t);
  }, [deliveryPostalCode, orderType, canDelivery, lookupEircode]);

  const getName = (translations: Translation[]) => {
    const found = translations.find(t2 => t2.locale === lang) || translations[0];
    return found?.name || '';
  };

  const filteredItems = useMemo(() => {
    let list = menuItems.filter(i => i.categoryId === activeCat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = menuItems.filter(i => i.translations.some(t2 => t2.name.toLowerCase().includes(q)));
    }
    return list;
  }, [menuItems, activeCat, search]);

  const addToOrder = (item: MenuItem) => {
    if (item.isSoldOut) return;
    if (item.optionGroups && item.optionGroups.length > 0) { setOptionModal(item); return; }
    setOrder(prev => [...prev, { id: nextLineId(), menuItemId: item._id, name: getName(item.translations), price: item.price }]);
  };

  const addToOrderWithOptions = (item: MenuItem, cartOptions: CartItemOption[]) => {
    const options: OrderItemOption[] = cartOptions.map(o => ({
      groupId: o.groupId,
      choiceId: o.choiceId,
      groupName: o.groupName,
      choiceName: o.choiceName,
      extraPrice: o.extraPrice,
    }));
    setOrder(prev => [...prev, { id: nextLineId(), menuItemId: item._id, name: getName(item.translations), price: item.price, options }]);
    setOptionModal(null);
  };

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');

  const startEditPrice = (lineId: string, currentPrice: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingLineId(lineId);
    setEditPrice(currentPrice.toFixed(2));
  };

  const confirmEditPrice = (lineId: string) => {
    const newPrice = parseFloat(editPrice);
    if (!isNaN(newPrice) && newPrice >= 0) {
      setOrder(prev => prev.map(o => o.id === lineId ? { ...o, price: newPrice } : o));
    }
    setEditingLineId(null);
  };

  const removeLine = (lineId: string) => { if (editingLineId) return; setOrder(prev => prev.filter(o => o.id !== lineId)); };
  const clearOrder = () => setOrder([]);

  const totalAmount = order.reduce((s, o) => s + o.price + (o.options || []).reduce((sum, opt) => sum + opt.extraPrice, 0), 0);
  const getItemCount = (menuItemId: string) => order.filter(o => o.menuItemId === menuItemId).length;

  // Bundle matching
  const matchedBundles: MatchedBundle[] = useMemo(() => {
    if (offers.length === 0 || order.length === 0) return [];
    const cartEntries = order.map(line => {
      const mi = menuItems.find(m => m._id === line.menuItemId);
      const optExtra = (line.options || []).reduce((s, o) => s + o.extraPrice, 0);
      return {
        key: line.id,
        menuItemId: line.menuItemId,
        categoryId: mi?.categoryId || '',
        basePrice: line.price,
        optionExtra: optExtra,
        quantity: 1,
      };
    });
    return matchBundles(cartEntries, offers);
  }, [order, offers, menuItems]);

  const bundleTotals = useMemo(() => {
    const cartEntries = order.map(line => {
      const optExtra = (line.options || []).reduce((s, o) => s + o.extraPrice, 0);
      return {
        key: line.id,
        menuItemId: line.menuItemId,
        categoryId: menuItems.find(m => m._id === line.menuItemId)?.categoryId || '',
        basePrice: line.price,
        optionExtra: optExtra,
        quantity: 1,
      };
    });
    return calcBundleTotal(cartEntries, matchedBundles);
  }, [order, matchedBundles, menuItems]);

  const finalTotal = bundleTotals.finalTotal;

  const deliveryFeeAmount = useMemo(() => {
    if (orderType !== 'delivery' || deliveryDistanceKm == null) return 0;
    return deliveryFeeForDistance(deliveryFeeRules, deliveryDistanceKm);
  }, [orderType, deliveryDistanceKm, deliveryFeeRules]);

  const grandTotal = finalTotal + (orderType === 'delivery' ? deliveryFeeAmount : 0);
  const displayTotal = orderType === 'delivery' ? grandTotal : finalTotal;

  // Open payment modal (no API call yet) — or create phone order directly
  const handleOpenPayment = () => {
    if (order.length === 0) return;
    if (orderType === 'phone') {
      handlePhoneOrder();
      return;
    }
    if (orderType === 'delivery') {
      if (!canDelivery) {
        setError(t('cashier.deliveryNotEnabledPlan'));
        return;
      }
      handleDeliveryPhoneOrder();
      return;
    }
    setPayingTotal(finalTotal);
    setCashReceived('');
    setPaymentMethod('cash');
    setMemberPhone('');
    setMemberPreview(null);
    setSelectedCoupon(null);
    setError('');
    setShowPayment(true);
  };

  // Phone order: create order only, print kitchen receipt, no payment
  const handlePhoneOrder = async () => {
    const guestPhone = phoneCustomerPhone.trim();
    if (!guestPhone) {
      setError(t('cashier.errFillGuestPhone'));
      return;
    }
    setPaying(true);
    setError('');
    try {
      const orderBody: Record<string, unknown> = { type: 'phone', customerPhone: guestPhone, items: buildGroupedItems() };
      if (matchedBundles.length > 0) {
        orderBody.appliedBundles = matchedBundles.map(b => ({ offerId: b.offer._id, name: b.offer.name, nameEn: b.offer.nameEn, discount: b.savings }));
      }
      const orderRes = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(orderBody),
      });
      if (!orderRes.ok) { const d = await orderRes.json().catch(() => null); throw new Error(d?.error?.message || 'Failed'); }
      const orderData = await orderRes.json();

      // Print receipt for phone order
      try {
        const configRes = await apiFetch('/api/admin/config');
        const cfg = configRes.ok ? await configRes.json() : {};
        const receiptData = {
          checkoutId: orderData._id,
          type: 'seat' as const,
          totalAmount: finalTotal,
          paymentMethod: 'cash' as const,
          checkedOutAt: new Date().toISOString(),
          orders: [{
            _id: orderData._id,
            type: 'phone' as const,
            dailyOrderNumber: orderData.dailyOrderNumber,
            status: 'pending',
            items: orderData.items,
            customerPhone: (typeof orderData.customerPhone === 'string' && orderData.customerPhone.trim())
              ? orderData.customerPhone.trim()
              : guestPhone,
          }],
        };
        const html = buildReceiptHTML(receiptData, cfg, undefined, undefined,
          matchedBundles.length > 0 ? matchedBundles.map(b => ({ name: b.offer.name, nameEn: b.offer.nameEn, discount: b.savings })) : undefined
        );
        printViaIframe(html, 1);
      } catch { /* print error ignored */ }

      setPhoneOrderId(orderData._id);
      setOrder([]);
      setPhoneCustomerPhone('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPaying(false);
    }
  };

  const handleDeliveryPhoneOrder = async () => {
    if (!deliveryCustomerName.trim() || !deliveryCustomerPhone.trim() || !deliveryAddress.trim() || !deliveryPostalCode.trim()) {
      setError(t('cashier.errDeliveryNeedFields'));
      return;
    }
    if (deliveryFeeRules.length > 0 && deliveryDistanceKm == null) {
      setError(t('cashier.deliveryFeeRulesNeedDistance'));
      return;
    }
    setPaying(true);
    setError('');
    try {
      const orderBody: Record<string, unknown> = {
        type: 'delivery',
        deliverySource: 'phone',
        customerName: deliveryCustomerName.trim(),
        customerPhone: deliveryCustomerPhone.trim(),
        deliveryAddress: deliveryAddress.trim(),
        postalCode: deliveryPostalCode.trim(),
        items: buildGroupedItems(),
      };
      if (matchedBundles.length > 0) {
        orderBody.appliedBundles = matchedBundles.map(b => ({ offerId: b.offer._id, name: b.offer.name, nameEn: b.offer.nameEn, discount: b.savings }));
      }
      if (deliveryDistanceKm != null) {
        orderBody.deliveryDistanceKm = deliveryDistanceKm;
      }
      if (deliveryCustomerProfileId.trim()) {
        orderBody.customerProfileId = deliveryCustomerProfileId.trim();
      }
      const orderRes = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(orderBody),
      });
      if (!orderRes.ok) {
        const d = (await orderRes.json().catch(() => null)) as {
          error?: { message?: string; details?: { customerProfiles?: typeof deliveryProfiles } };
        } | null;
        if (orderRes.status === 409 && d?.error?.details?.customerProfiles?.length) {
          setDeliveryProfiles(d.error.details.customerProfiles);
        }
        throw new Error(d?.error?.message || 'Failed');
      }
      const orderData = await orderRes.json();
      try {
        const configRes = await apiFetch('/api/admin/config');
        const cfg = configRes.ok ? await configRes.json() : {};
        const rawItems = orderData.items as Array<{
          unitPrice: number; quantity: number; selectedOptions?: { extraPrice?: number }[];
        }>;
        const itemGross = rawItems.reduce((s, i) => {
          const ox = (i.selectedOptions || []).reduce((a, o) => a + (o.extraPrice || 0), 0);
          return s + (i.unitPrice + ox) * i.quantity;
        }, 0);
        const disc = (orderData.appliedBundles as Array<{ discount: number }> | undefined)?.reduce((a, b) => a + b.discount, 0) ?? 0;
        const receiptData = {
          checkoutId: orderData._id,
          type: 'seat' as const,
          totalAmount: itemGross - disc,
          paymentMethod: 'cash' as const,
          checkedOutAt: new Date().toISOString(),
          orders: [{
            _id: orderData._id,
            type: 'delivery' as const,
            dailyOrderNumber: orderData.dailyOrderNumber,
            status: 'pending',
            items: orderData.items,
            customerName: (typeof orderData.customerName === 'string' && orderData.customerName.trim())
              ? orderData.customerName.trim()
              : deliveryCustomerName.trim(),
            customerPhone: (typeof orderData.customerPhone === 'string' && orderData.customerPhone.trim())
              ? orderData.customerPhone.trim()
              : deliveryCustomerPhone.trim(),
            deliveryAddress: (typeof orderData.deliveryAddress === 'string' && orderData.deliveryAddress.trim())
              ? orderData.deliveryAddress.trim()
              : deliveryAddress.trim(),
            postalCode: (typeof orderData.postalCode === 'string' && orderData.postalCode.trim())
              ? orderData.postalCode.trim()
              : deliveryPostalCode.trim(),
          }],
        };
        const html = buildReceiptHTML(receiptData, cfg, undefined, undefined,
          matchedBundles.length > 0 ? matchedBundles.map(b => ({ name: b.offer.name, nameEn: b.offer.nameEn, discount: b.savings })) : undefined
        );
        printViaIframe(html, 1);
      } catch { /* print error ignored */ }
      setPhoneOrderId(orderData._id);
      setOrder([]);
      setDeliveryCustomerName('');
      setDeliveryCustomerPhone('');
      setDeliveryAddress('');
      setDeliveryPostalCode('');
      setDeliveryCustomerProfileId('');
      setDeliveryProfiles([]);
      setDeliveryCustomerCollapsed(false);
      setFrequentItems([]);
      setFrequentItemsExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPaying(false);
    }
  };

  // Build grouped items for API
  const buildGroupedItems = () => {
    const grouped = new Map<string, { menuItemId: string; quantity: number; selectedOptions?: { groupId: string; choiceId: string }[] }>();
    for (const line of order) {
      const mi = menuItems.find(m => m._id === line.menuItemId);
      let selOpts: { groupId: string; choiceId: string }[] | undefined;
      if (line.options && line.options.length > 0 && mi?.optionGroups) {
        selOpts = line.options.map(opt => {
          // Prefer persisted IDs from selection time; fallback to name matching for legacy lines.
          if (opt.groupId && opt.choiceId) {
            return { groupId: opt.groupId, choiceId: opt.choiceId };
          }
          const group = mi.optionGroups!.find(g => g.translations.some(t2 => Object.values(opt.groupName).includes(t2.name)));
          const choice = group?.choices.find(c => c.translations.some(t2 => Object.values(opt.choiceName).includes(t2.name)));
          return { groupId: group?._id || '', choiceId: choice?._id || '' };
        }).filter(o => o.groupId && o.choiceId);
      }
      const key = line.menuItemId + '|' + JSON.stringify(selOpts || []);
      const existing = grouped.get(key);
      if (existing) existing.quantity++;
      else grouped.set(key, { menuItemId: line.menuItemId, quantity: 1, selectedOptions: selOpts });
    }
    return [...grouped.values()];
  };

  // Confirm: create order + checkout in one go
  const couponDiscount = selectedCoupon?.amount || 0;
  const payAfterCoupon = Math.max(0, payingTotal - couponDiscount);
  const cashReceivedNum = parseFloat(cashReceived) || 0;
  const changeAmount = paymentMethod === 'cash' ? Math.max(0, cashReceivedNum - payAfterCoupon) : 0;

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      // Step 1: Create order
      const orderBody: Record<string, unknown> = { type: orderType, items: buildGroupedItems() };
      if (orderType === 'dine_in') { orderBody.tableNumber = 0; orderBody.seatNumber = 0; }
      if (matchedBundles.length > 0) {
        orderBody.appliedBundles = matchedBundles.map(b => ({ offerId: b.offer._id, name: b.offer.name, nameEn: b.offer.nameEn, discount: b.savings }));
      }

      const orderRes = await apiFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(orderBody),
      });
      if (!orderRes.ok) { const d = await orderRes.json().catch(() => null); throw new Error(d?.error?.message || 'Failed'); }
      const orderData = await orderRes.json();

      // Step 2: Checkout immediately
      const checkoutBody: Record<string, unknown> =
        paymentMethod === 'member' && memberPreview
          ? {
              ...buildMemberFullWalletCheckoutBody(payAfterCoupon, memberPreview.phone),
              ...(bundleTotals.bundleDiscount > 0 ? { totalAmountOverride: payingTotal } : {}),
              ...(selectedCoupon
                ? { couponName: selectedCoupon.name, couponAmount: selectedCoupon.amount }
                : {}),
            }
          : { paymentMethod };
      if (paymentMethod !== 'member') {
        if (bundleTotals.bundleDiscount > 0) {
          checkoutBody.totalAmountOverride = payingTotal;
        }
        if (selectedCoupon) {
          checkoutBody.couponName = selectedCoupon.name;
          checkoutBody.couponAmount = selectedCoupon.amount;
        }
        if (paymentMethod === 'cash') checkoutBody.cashAmount = payAfterCoupon;
        else if (paymentMethod === 'card') checkoutBody.cardAmount = payAfterCoupon;
        else {
          checkoutBody.cashAmount = Number(mixedCash);
          checkoutBody.cardAmount = Number(mixedCard);
        }
      }

      const checkoutRes = await apiFetch(`/api/checkout/seat/${orderData._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(checkoutBody),
      });
      if (!checkoutRes.ok) { const d = await checkoutRes.json().catch(() => null); throw new Error(d?.error?.message || 'Checkout failed'); }
      const checkoutData = await checkoutRes.json();
      setCheckoutId(checkoutData._id);
      setCheckoutMeta({ total: payAfterCoupon, cashReceived: cashReceivedNum, change: changeAmount });
      setReceiptBundleDiscounts(matchedBundles.map(b => ({ name: b.offer.name, nameEn: b.offer.nameEn, discount: b.savings })));
      setShowPayment(false);
      setOrder([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPaying(false);
    }
  };

  const handleCloseReceipt = () => {
    setCheckoutId(null);
    setCheckoutMeta(null);
    setReceiptBundleDiscounts([]);
  };

  const renderDeliveryGeoSection = () => (
    <>
      {deliveryGeoLoading ? (
        <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{t('cashier.deliveryParsingPostcode')}</div>
      ) : null}
      {deliveryGeoError ? (
        <div style={{ fontSize: 11, color: 'var(--red-primary)' }}>{deliveryGeoError}</div>
      ) : null}
      {deliveryDistanceKm != null && !deliveryGeoLoading ? (
        <div style={{ fontSize: 12, color: '#1565c0' }}>{t('cashier.deliveryDistanceKm', { km: deliveryDistanceKm })}</div>
      ) : null}
      {deliveryAddress.trim() || deliveryPostalCode.trim() ? (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryAddress.trim() || deliveryPostalCode.trim())}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: '#1565c0', textDecoration: 'underline', display: 'inline-block', marginTop: 2 }}
        >
          {t('cashier.openInGoogleMaps')} ↗
        </a>
      ) : null}
      {deliveryFeeRules.length > 0 && deliveryDistanceKm != null ? (
        <div style={{ fontSize: 12, color: '#1565c0', marginTop: 4 }}>
          {t('cashier.deliveryFee')}: <strong>€{deliveryFeeAmount.toFixed(2)}</strong>
        </div>
      ) : null}
      {deliveryFeeRules.length > 0 && !deliveryGeoLoading && deliveryPostalCode.trim().length >= 5 && deliveryDistanceKm == null && !deliveryGeoError ? (
        <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>{t('cashier.deliveryFeeRulesNeedDistance')}</div>
      ) : null}
    </>
  );

  // Phone order success screen
  if (phoneOrderId) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📞</div>
          <h2 style={{ color: 'var(--blue, #1976D2)', marginBottom: 12 }}>{t('cashier.phoneOrderCreated')}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{t('cashier.phoneOrderPayLater')}</p>
          <button className="btn btn-primary" onClick={() => setPhoneOrderId(null)} style={{ marginBottom: 20 }}>{t('cashier.continueOrder')}</button>
        </div>
      </div>
    );
  }

  // Receipt screen
  if (checkoutId) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
          <h2 style={{ color: 'var(--green)', marginBottom: 12 }}>{t('cashier.checkoutSuccess')}</h2>
          {checkoutMeta && paymentMethod === 'cash' && checkoutMeta.change > 0 && (
            <div style={{ background: '#FFF3E0', border: '2px solid #FF9800', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('cashier.total')}: €{checkoutMeta.total.toFixed(2)}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('cashier.cashReceived')}: €{checkoutMeta.cashReceived.toFixed(2)}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#E65100' }}>{t('cashier.change')}: €{checkoutMeta.change.toFixed(2)}</div>
            </div>
          )}
          <button className="btn btn-primary" onClick={handleCloseReceipt} style={{ marginBottom: 20 }}>{t('cashier.continueOrder')}</button>
          <button className="btn btn-outline" onClick={() => window.print()} style={{ marginBottom: 20, marginLeft: 8 }}>
            {t('cashier.printReceiptBtn')}
          </button>
        </div>
        <ReceiptPrint checkoutId={checkoutId} cashReceived={checkoutMeta?.cashReceived} changeAmount={checkoutMeta?.change} bundleDiscounts={receiptBundleDiscounts} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 0 }}>
      {/* Left: Category Sidebar */}
      <div style={{ width: 110, flexShrink: 0, background: 'var(--bg-white)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '8px 0' }}>
        {categories.map(cat => {
          const isActive = activeCat === cat._id;
          return (
            <button key={cat._id} onClick={() => { setActiveCat(cat._id); setSearch(''); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '14px 8px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--red-primary)' : 'var(--text-secondary)', background: isActive ? 'var(--red-light)' : 'transparent', borderLeft: isActive ? '4px solid var(--red-primary)' : '4px solid transparent', minHeight: 56 }}>
              {getName(cat.translations)}
            </button>
          );
        })}
      </div>

      {/* Center: Menu Grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', background: 'var(--bg-white)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input className="input" placeholder={t('cashier.searchMenuPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '10px 14px', fontSize: 14 }} />
        </div>
        <div style={{ padding: '10px 12px 6px', fontSize: 14, fontWeight: 700, background: 'var(--bg)', flexShrink: 0 }}>
          {search ? t('cashier.searchResultsFor', { q: search }) : getName(categories.find(c => c._id === activeCat)?.translations || [])}
          <span style={{ fontWeight: 400, color: 'var(--text-light)', marginLeft: 8 }}>({filteredItems.length})</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, alignContent: 'start' }}>
          {filteredItems.map(item => {
            const qty = getItemCount(item._id);
            return (
              <div key={item._id} onClick={() => addToOrder(item)} style={{ background: 'var(--bg-white)', border: qty > 0 ? '2px solid var(--red-primary)' : '1px solid var(--border)', borderRadius: 8, padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', cursor: item.isSoldOut ? 'not-allowed' : 'pointer', opacity: item.isSoldOut ? 0.4 : 1, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', minHeight: 80, justifyContent: 'center', position: 'relative', userSelect: 'none' }}>
                {qty > 0 && <span style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: '50%', background: 'var(--red-primary)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{qty}</span>}
                {item.isSoldOut && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600, background: '#9E9E9E', color: '#fff' }}>{t('cashier.orderSoldOutBadge')}</span>}
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{getName(item.translations)}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--red-primary)' }}>€{item.price}</div>
                {item.optionGroups && item.optionGroups.length > 0 && <div style={{ fontSize: 9, color: 'var(--text-light)', marginTop: 2 }}>⚙ {t('customer.selectOptions')}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Order Panel */}
      <div style={{ width: 320, flexShrink: 0, background: 'var(--bg-white)', borderLeft: '2px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>🧾 {t('cashier.orderPoint')}</h3>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={clearOrder}>{t('cashier.clearOrder')}</button>
        </div>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => { setOrderType('dine_in'); setDeliveryCustomerProfileId(''); }} style={{ flex: 1, fontSize: 12, padding: '6px 0', background: orderType === 'dine_in' ? 'var(--red-primary)' : 'var(--bg)', color: orderType === 'dine_in' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>{t('cashier.orderTypeDineIn')}</button>
            <button className="btn" onClick={() => { setOrderType('takeout'); setDeliveryCustomerProfileId(''); }} style={{ flex: 1, fontSize: 12, padding: '6px 0', background: orderType === 'takeout' ? 'var(--red-primary)' : 'var(--bg)', color: orderType === 'takeout' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>{t('cashier.orderTypeTakeout')}</button>
            <button className="btn" onClick={() => { setOrderType('phone'); setDeliveryCustomerProfileId(''); }} style={{ flex: 1, fontSize: 12, padding: '6px 0', background: orderType === 'phone' ? 'var(--red-primary)' : 'var(--bg)', color: orderType === 'phone' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>{t('cashier.orderTypePhone')}</button>
            {canDelivery ? (
              <button className="btn" onClick={() => setOrderType('delivery')} style={{ flex: 1, fontSize: 12, padding: '6px 0', background: orderType === 'delivery' ? 'var(--red-primary)' : 'var(--bg)', color: orderType === 'delivery' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>{t('cashier.orderTypeDelivery')}</button>
            ) : null}
          </div>
        </div>
        {orderType === 'phone' && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <input className="input" placeholder={t('cashier.phoneGuestPlaceholder')} value={phoneCustomerPhone} onChange={e => setPhoneCustomerPhone(e.target.value)} />
          </div>
        )}
        {orderType === 'delivery' && deliveryCustomerCollapsed ? (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t('cashier.deliverySummaryTitle')}</span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => setDeliveryCustomerCollapsed(false)}
              >
                {t('cashier.deliveryEditCustomer')}
              </button>
            </div>
            <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.35 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: 'var(--text-light)', fontSize: 11 }}>{t('cashier.deliverySummaryName')}</span>{' '}
                  <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{deliveryCustomerName.trim() || t('cashier.profileAddressDash')}</span>
                </div>
                <div style={{ width: 1, alignSelf: 'stretch', minHeight: 28, background: 'var(--border)', flexShrink: 0 }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: 'var(--text-light)', fontSize: 11 }}>{t('cashier.deliverySummaryPhone')}</span>{' '}
                  <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{deliveryCustomerPhone.trim() || t('cashier.profileAddressDash')}</span>
                </div>
              </div>
              <div style={{ lineHeight: 1.35 }}>
                <span style={{ color: 'var(--text-light)', fontSize: 11 }}>{t('cashier.deliverySummaryAddress')}</span>{' '}
                <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{deliveryAddress.trim() || t('cashier.profileAddressDash')}</span>
              </div>
            </div>
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFrequentItemsExpanded((v) => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 0',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>{t('cashier.frequentItemsTitle', { days: FREQUENT_LOOKBACK_DAYS })}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }} aria-hidden>{frequentItemsExpanded ? '▲' : '▼'}</span>
              </button>
              {frequentItemsExpanded ? (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-light)', marginBottom: 6, lineHeight: 1.35 }}>
                    {t('cashier.frequentItemsHint')}
                  </div>
                  {frequentItemsLoading ? (
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{t('cashier.frequentItemsLoading')}</div>
                  ) : frequentItems.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{t('cashier.frequentItemsEmpty')}</div>
                  ) : (
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.45 }}>
                      {frequentItems.map((row) => {
                        const label =
                          lang.startsWith('zh') || !row.itemNameEn?.trim()
                            ? row.itemName
                            : row.itemNameEn;
                        return (
                          <li key={row.menuItemId} style={{ marginBottom: 3 }}>
                            <span style={{ fontWeight: 600 }}>{label}</span>
                            <span style={{ color: 'var(--text-light)', marginLeft: 4 }}>
                              {t('cashier.frequentItemsCount', { count: row.orderCount })}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              ) : null}
            </div>
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 6, fontWeight: 600 }}>{t('cashier.deliveryMapInfoTitle')}</div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-light)', fontSize: 11 }}>{t('cashier.deliverySummaryEircode')}</span>{' '}
                <span style={{ fontWeight: 600 }}>{deliveryPostalCode.trim() || t('cashier.profileAddressDash')}</span>
              </div>
              {renderDeliveryGeoSection()}
            </div>
          </div>
        ) : null}
        {orderType === 'delivery' && !deliveryCustomerCollapsed ? (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'grid', gap: 6 }}>
            <input
              className="input"
              placeholder={t('cashier.deliveryPhonePlaceholder')}
              value={deliveryCustomerPhone}
              onChange={(e) => {
                deliveryPhoneRef.current = e.target.value;
                setDeliveryCustomerPhone(e.target.value);
                setDeliveryCustomerProfileId('');
                setDeliveryCustomerCollapsed(false);
              }}
              onBlur={(e) => void runMemberDeliveryLookup(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const el = e.target as HTMLInputElement;
                  void runMemberDeliveryLookup(el.value);
                  el.blur();
                }
              }}
            />
            <input className="input" placeholder={t('cashier.deliveryCustomerNamePlaceholder')} value={deliveryCustomerName} onChange={e => setDeliveryCustomerName(e.target.value)} />
            {deliveryProfiles.length > 0 ? (
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>{t('cashier.deliveryProfileLabel')}</label>
                <select
                  className="input"
                  style={{ width: '100%', fontSize: 13 }}
                  value={deliveryCustomerProfileId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDeliveryCustomerProfileId(v);
                    if (v) {
                      const p = deliveryProfiles.find((x) => x._id === v);
                      if (p) {
                        if (p.customerName) setDeliveryCustomerName(p.customerName);
                        if (p.deliveryAddress) setDeliveryAddress(p.deliveryAddress);
                        if (p.postalCode) setDeliveryPostalCode(p.postalCode);
                      }
                    }
                  }}
                >
                  <option value="">{t('cashier.deliveryProfileAutoOption')}</option>
                  {deliveryProfiles.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.deliveryAddress || t('cashier.profileAddressDash')} · {p.postalCode || t('cashier.profileAddressDash')}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <input
              className="input"
              placeholder={t('cashier.deliveryEircodePlaceholder')}
              value={deliveryPostalCode}
              onChange={e => setDeliveryPostalCode(e.target.value)}
              autoCapitalize="characters"
            />
            <input className="input" placeholder={t('cashier.deliveryAddressPlaceholder')} value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} />
            {renderDeliveryGeoSection()}
          </div>
        ) : null}

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {order.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-light)', gap: 8 }}>
              <span style={{ fontSize: 36, opacity: 0.3 }}>📋</span>
              <span style={{ fontSize: 13 }}>{t('cashier.emptyOrderHint')}</span>
            </div>
          ) : order.map((line, idx) => {
            const optExtra = (line.options || []).reduce((sum, opt) => sum + opt.extraPrice, 0);
            const isEditing = editingLineId === line.id;
            return (
              <div key={line.id} onClick={() => removeLine(line.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FFEBEE')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 11, color: 'var(--text-light)', minWidth: 20 }}>{idx + 1}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.name}</div>
                  {line.options && line.options.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-light)' }}>
                      {line.options.map((opt, i) => <span key={i}>{i > 0 && ' · '}{opt.choiceName[lang] || Object.values(opt.choiceName)[0]}{opt.extraPrice > 0 && ` +€${opt.extraPrice}`}</span>)}
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 12, color: 'var(--text-light)' }}>€</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      value={editPrice}
                      onChange={e => setEditPrice(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmEditPrice(line.id); if (e.key === 'Escape') setEditingLineId(null); }}
                      onBlur={() => confirmEditPrice(line.id)}
                      autoFocus
                      style={{ width: 60, fontSize: 13, fontWeight: 700, padding: '2px 4px', textAlign: 'right' }}
                    />
                  </div>
                ) : (
                  <span
                    onClick={(e) => startEditPrice(line.id, line.price + optExtra, e)}
                    style={{ fontSize: 13, fontWeight: 700, color: 'var(--red-primary)', minWidth: 45, textAlign: 'right', cursor: 'text', borderBottom: '1px dashed var(--red-primary)' }}
                  >€{(line.price + optExtra).toFixed(2)}</span>
                )}
                <span style={{ fontSize: 14, color: 'var(--text-light)', marginLeft: 4 }}>✕</span>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: '2px solid var(--border)', padding: '12px 16px', flexShrink: 0 }}>
          {error && <div style={{ color: 'var(--red-primary)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          {/* Bundle discount display */}
          {matchedBundles.length > 0 && (
            <div style={{ marginBottom: 8, padding: '8px 10px', background: '#E8F5E9', borderRadius: 8 }}>
              {matchedBundles.map((b, i) => (
                <div key={i} style={{ fontSize: 12, color: '#2E7D32', display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span>🎁 {b.offer.name}</span>
                  <span style={{ fontWeight: 600 }}>-€{b.savings.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('cashier.totalItemsLine', { count: order.length })}</span>
            <div style={{ textAlign: 'right' }}>
              {bundleTotals.bundleDiscount > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-light)', textDecoration: 'line-through' }}>€{totalAmount.toFixed(2)}</div>
              )}
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--red-primary)', fontFamily: "'Noto Serif SC', serif" }}>€{displayTotal.toFixed(2)}</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleOpenPayment} disabled={order.length === 0} style={{ width: '100%', fontSize: 15, padding: '12px 0', letterSpacing: 1 }}>
            {t('cashier.placeOrderCheckout')}
          </button>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 380, maxWidth: '90%' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, textAlign: 'center' }}>{t('cashier.checkout')}</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20, marginBottom: 12 }}>
              <span>{t('cashier.total')}</span>
              <span style={{ color: 'var(--red-primary)' }}>€{payingTotal.toFixed(2)}</span>
            </div>

            {/* Coupon selection */}
            {availableCoupons.length > 0 && (
              <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 6 }}>{t('cashier.couponSectionTitle')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {availableCoupons.map(c => {
                    const isSelected = selectedCoupon?.name === c.name && selectedCoupon?.amount === c.amount;
                    return (
                      <button key={c._id} onClick={() => {
                        if (isSelected) { setSelectedCoupon(null); setCashReceived(''); }
                        else { setSelectedCoupon(c); setCashReceived(''); }
                      }}
                        className="btn" style={{
                          padding: '6px 12px', fontSize: 12, borderRadius: 20,
                          background: isSelected ? '#4CAF50' : 'var(--bg-white)',
                          color: isSelected ? '#fff' : 'var(--text-secondary)',
                          border: isSelected ? '2px solid #388E3C' : '1px solid var(--border)',
                        }}>
                        {c.name} -€{c.amount.toFixed(2)}
                      </button>
                    );
                  })}
                </div>
                {selectedCoupon && (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                    <span style={{ color: '#2E7D32' }}>{t('cashier.afterCoupon')}</span>
                    <span style={{ color: '#2E7D32' }}>€{payAfterCoupon.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {(canMemberWallet ? (['cash', 'card', 'mixed', 'member'] as const) : (['cash', 'card', 'mixed'] as const)).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(m);
                    setCashReceived('');
                    if (m !== 'member') {
                      setMemberPreview(null);
                    }
                  }}
                  className="btn"
                  style={{
                    flex: '1 1 40%',
                    minWidth: 72,
                    background: paymentMethod === m ? 'var(--red-primary)' : 'var(--bg)',
                    color: paymentMethod === m ? '#fff' : 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {t(`cashier.${m}`)}
                </button>
              ))}
            </div>

            {paymentMethod === 'member' ? (
              <CashierMemberCheckoutBlock
                payAmount={payAfterCoupon}
                phone={memberPhone}
                setPhone={setMemberPhone}
                preview={memberPreview}
                setPreview={setMemberPreview}
              />
            ) : null}

            {paymentMethod === 'cash' && (
              <div style={{ padding: 10, background: 'var(--bg)', borderRadius: 8, marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-light)', display: 'block', marginBottom: 4 }}>{t('cashier.cashReceived')}</label>
                <input className="input" type="number" step="0.01" value={cashReceived} onChange={e => setCashReceived(e.target.value)}
                  style={{ width: '100%', fontSize: 18, fontWeight: 700, padding: '8px 10px', textAlign: 'right' }} />
                {cashReceivedNum > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, background: cashReceivedNum >= payAfterCoupon ? '#E8F5E9' : '#FFEBEE' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t('cashier.change')}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: cashReceivedNum >= payAfterCoupon ? 'var(--green)' : 'var(--red-primary)' }}>€{changeAmount.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {paymentMethod === 'mixed' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input" placeholder={t('cashier.cashAmount')} value={mixedCash} onChange={e => setMixedCash(e.target.value)} type="number" />
                <input className="input" placeholder={t('cashier.cardAmount')} value={mixedCard} onChange={e => setMixedCard(e.target.value)} type="number" />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowPayment(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handlePay}
                disabled={
                  paying ||
                  (paymentMethod === 'cash' && cashReceivedNum < payAfterCoupon) ||
                  (paymentMethod === 'member' && !canMemberFullWalletPay(memberPreview, payAfterCoupon))
                }>
                {paying ? t('common.loading') : t('cashier.submitCheckout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Option selection modal */}
      {optionModal && optionModal.optionGroups && optionModal.optionGroups.length > 0 && (
        <OptionSelectModal
          itemName={getName(optionModal.translations)}
          price={optionModal.price}
          optionGroups={optionModal.optionGroups}
          onConfirm={(opts) => addToOrderWithOptions(optionModal, opts)}
          onClose={() => setOptionModal(null)}
        />
      )}
    </div>
  );
}
