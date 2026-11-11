import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from './lib/supabase';
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from './legal/terms';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  Image,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';

WebBrowser.maybeCompleteAuthSession();
const SUPPORT_EMAIL = 'support@getbuy.com.ng';
const PAYMENT_SIMULATOR_AVAILABLE = __DEV__;
const isValidEmailOtp = (token: string) => /^\d{6,8}$/.test(token);
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

type Role = 'buyer' | 'seller' | 'delivery' | 'admin';
type Order = {
  id: string;
  dbId: string;
  status: string;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentSimulated: boolean;
  deliveryProofUrl?: string;
  buyerConfirmedAt: string | null;
  deliveryAddress: string;
  deliveryDate: string;
  deliverySlot: string;
  promoCode: string | null;
  promoDiscount: number;
  createdAt: string;
  items: Product[];
  reviews: StoreReview[];
  issues: OrderIssue[];
};
type StoreReview = {
  storeId: string;
  rating: number;
  review: string;
};
type PublicStoreReview = {
  rating: number;
  review: string;
  created_at: string;
  buyer_label: string;
};
type ChatMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  message: string;
  created_at: string;
};
type MarketplaceAlert = {
  id: string;
  product_id: string | null;
  alert_type: 'back_in_stock' | 'low_stock';
  message: string;
  read_at: string | null;
  created_at: string;
};
type OrderIssue = {
  id: string;
  issueType: string;
  description: string;
  status: string;
  adminNote: string;
  createdAt: string;
};
type SellerOrderItem = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  substitutionStatus?: string;
};
type SellerOrder = {
  dbId: string;
  id: string;
  items: string[];
  orderItems: SellerOrderItem[];
  status: string;
  deliveryAddress: string;
  deliveryDate: string;
  deliverySlot: string;
  promoCode: string | null;
  promoDiscount: number;
  total: number;
  assignedDeliveryId: string | null;
};

type DeliveryOrder = {
  id: string;
  status: string;
  deliveryAddress: string;
  deliveryDate: string;
  deliverySlot: string;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentSimulated: boolean;
  assignedToCurrent: boolean;
  buyerName: string;
  buyerDirections: string;
  pickupDetails: string;
  itemsSummary: string;
  updatedAt: string;
};
type DeliveryProofDraft = {
  uri: string;
  base64: string;
  mimeType: string;
};
type RiderRemittance = {
  order_id: string;
  expected_amount: number;
  status: string;
  transfer_reference: string;
};
type CollectionAccount = { bank_name: string; account_name: string; account_number: string };
type PayoutHistoryItem = {
  order_id: string;
  payout_type: string;
  amount: number;
  status: string;
  transfer_reference: string;
  paid_at: string | null;
  remittance_status: string;
};
type SellerPayoutSummary = {
  awaiting_reconciliation: number;
  ready_for_payout: number;
  paid_to_date: number;
};
type RiderPayoutSummary = {
  earned_today: number;
  awaiting_reconciliation: number;
  ready_for_payout: number;
  paid_to_date: number;
};
type RiderLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updatedAt: string;
};
type DeliveryDashboardRow = {
  id: string;
  status: string;
  delivery_address: string;
  total: number | string;
  assigned_delivery_id: string | null;
  buyer_name: string | null;
  buyer_directions: string | null;
  pickup_details: string | null;
  items_summary: string | null;
  updated_at: string;
};
type DeliveryPaymentRow = {
  id: string;
  payment_method: string;
  payment_status: string;
  payment_simulated: boolean;
};
type SellerDashboardOrderRow = {
  order_id: string;
  status: string;
  delivery_address: string;
  total: number | string;
  assigned_delivery_id: string | null;
  items_summary: string | null;
};
type Screen =
  | 'welcome'
  | 'roleChoice'
  | 'auth'
  | 'create'
  | 'signin'
  | 'verifySignup'
  | 'forgotPassword'
  | 'verifyRecovery'
  | 'newPassword'
  | 'location'
  | 'sellerSetup'
  | 'complete'
  | 'dashboard'
  | 'cart'
  | 'orders'
  | 'sellerDashboard'
  | 'deliverySetup'
  | 'deliveryDashboard'
  | 'adminSetup'
  | 'adminDashboard'
  | 'profile'
  | 'saved'
  | 'productDetail'
  | 'storefront'
  | 'orderChat'
  | 'checkout'
  | 'tracking'
  | 'notifications'
  | 'support'
  | 'terms'
  | 'bulkProducts'
  | 'addProduct';
type AppNavigationState = {
  screen: Screen;
  role: Role | null;
  isGuestBrowsing: boolean;
  cartCount: number;
  navigate: (screen: Screen) => void;
};
type NavigationTab = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  destination: Screen;
  active: boolean;
};

let appNavigationState: AppNavigationState | null = null;
const appNavigationListeners = new Set<() => void>();

function subscribeToAppNavigation(listener: () => void) {
  appNavigationListeners.add(listener);
  return () => appNavigationListeners.delete(listener);
}

function publishAppNavigation(state: AppNavigationState) {
  appNavigationState = state;
  appNavigationListeners.forEach((listener) => listener());
}

function getAppNavigationSnapshot() {
  return appNavigationState;
}

function getNavigationTabs(navigation: AppNavigationState): NavigationTab[] {
  const { screen, role, isGuestBrowsing } = navigation;
  if (role === 'seller') {
    return [
      { label: 'Overview', icon: 'grid-outline', destination: 'sellerDashboard', active: screen === 'sellerDashboard' },
      { label: 'Listings', icon: 'pricetag-outline', destination: 'addProduct', active: screen === 'addProduct' || screen === 'bulkProducts' },
      { label: 'Profile', icon: 'person-outline', destination: 'profile', active: screen === 'profile' },
    ];
  }
  if (role === 'delivery') {
    return [
      { label: 'Jobs', icon: 'bicycle-outline', destination: 'deliveryDashboard', active: screen === 'deliveryDashboard' || screen === 'orders' || screen === 'tracking' },
      { label: 'Profile', icon: 'person-outline', destination: 'profile', active: screen === 'profile' },
    ];
  }
  return [
    { label: 'Market', icon: 'storefront-outline', destination: 'dashboard', active: ['dashboard', 'saved', 'productDetail', 'storefront', 'notifications', 'support', 'terms'].includes(screen) },
    { label: isGuestBrowsing ? 'Sign in' : 'Orders', icon: isGuestBrowsing ? 'log-in-outline' : 'receipt-outline', destination: isGuestBrowsing ? 'signin' : 'orders', active: screen === 'orders' || screen === 'tracking' || screen === 'orderChat' },
    { label: 'Cart', icon: 'cart-outline', destination: 'cart', active: screen === 'cart' || screen === 'checkout' },
    { label: isGuestBrowsing ? 'Sign up' : 'Profile', icon: 'person-outline', destination: isGuestBrowsing ? 'create' : 'profile', active: screen === 'profile' },
  ];
}

const screensWithoutNavigation: Screen[] = [
  'welcome',
  'roleChoice',
  'auth',
  'create',
  'signin',
  'verifySignup',
  'forgotPassword',
  'verifyRecovery',
  'newPassword',
  'location',
  'sellerSetup',
  'deliverySetup',
  'complete',
  'adminSetup',
  'adminDashboard',
];
type Product = {
  id?: string;
  storeId?: string;
  storeArea?: string;
  orderItemId?: string;
  name: string;
  store: string;
  price: string;
  category: string;
  imageUrl?: string;
  quantity?: string;
  unit?: string;
  variants?: ProductVariant[];
  orderVariantId?: string;
  orderVariantLabel?: string;
  orderCustomQuantity?: boolean;
  description?: string;
  isAvailable?: boolean;
  storeVerified?: boolean;
  storeCategory?: string;
  substitutionOffer?: { status: string; product: Product };
};
type ProductVariant = {
  id: string;
  name: string;
  unit: string;
  price: number;
  stock: number;
};
type ProductVariantDraft = {
  id: string;
  name: string;
  unit: string;
  price: string;
  stock: string;
};
type CartLine = {
  key: string;
  product: Product;
  quantity: number;
  variant?: ProductVariant;
  customQuantity: boolean;
};
type BulkProductDraft = {
  id: string;
  imageUri: string;
  imageBase64: string;
  imageMimeType: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  unit: string;
};
const PRODUCT_CATEGORIES = [
  'Vegetables',
  'Fruits',
  'Tubers & Roots',
  'Rice & Grains',
  'Beans & Legumes',
  'Swallow Flours',
  'Noodles & Pasta',
  'Cooking Oils',
  'Herbs & Spices',
  'Beef & Goat',
  'Poultry & Eggs',
  'Seafood',
  'Bread & Bakery',
  'Dairy & Alternatives',
  'Seasonings & Spices',
  'Cereals & Oats',
  'Drinks',
  'Laundry & Dishes',
  'Household Surface Care',
  'Hygiene & Toiletries',
  'Hair & Skin Care',
  'Baby Care',
  'Baby Food',
  'Rice Dishes',
  'Soups & Swallows',
  'Protein Add-ons',
  'Snacks & Pastries',
  'Grills & Platters',
  'Salads',
  'Platters & Combos',
  'Other Produce',
  'Pantry',
  'Produce',
  'Packaged Goods',
  'Kitchen Utensils',
] as const;
const MARKETPLACE_CATEGORY_FILTERS = [...new Set([
  'All',
  'Food',
  'Vegetables',
  'Fruits',
  'Packaged Goods',
  'Kitchen Utensils',
  'Restaurants',
  ...PRODUCT_CATEGORIES,
])];
const MARKETPLACE_PAGE_SIZE = 24;
const FOOD_CATEGORIES = new Set([
  'vegetables',
  'fruits',
  'tubers & roots',
  'rice & grains',
  'beans & legumes',
  'swallow flours',
  'noodles & pasta',
  'cooking oils',
  'herbs & spices',
  'beef & goat',
  'poultry & eggs',
  'seafood',
  'bread & bakery',
  'dairy & alternatives',
  'seasonings & spices',
  'cereals & oats',
  'drinks',
  'baby food',
  'rice dishes',
  'soups & swallows',
  'protein add-ons',
  'snacks & pastries',
  'grills & platters',
  'salads',
  'platters & combos',
  'other produce',
  'pantry',
  'produce',
  'packaged goods',
]);
const PACKAGED_GOOD_CATEGORIES = new Set([
  'rice & grains',
  'beans & legumes',
  'swallow flours',
  'noodles & pasta',
  'cooking oils',
  'herbs & spices',
  'seasonings & spices',
  'cereals & oats',
  'drinks',
  'dairy & alternatives',
  'baby food',
  'pantry',
  'packaged goods',
]);
const matchesMarketplaceCategory = (product: Product, selectedCategory: string) => {
  const productCategory = product.category.trim().toLowerCase();
  const storeCategory = product.storeCategory?.trim().toLowerCase() || '';
  if (selectedCategory === 'All') return true;
  if (selectedCategory === 'Food') return FOOD_CATEGORIES.has(productCategory);
  if (selectedCategory === 'Packaged Goods') return PACKAGED_GOOD_CATEGORIES.has(productCategory);
  if (selectedCategory === 'Restaurants') {
    return /restaurant|cafe|eatery|food vendor/.test(`${storeCategory} ${productCategory}`);
  }
  if (selectedCategory === 'Kitchen Utensils') {
    return /kitchen|utensil|cookware|kitchenware/.test(productCategory);
  }
  return productCategory === selectedCategory.toLowerCase();
};
const normalizeMarketArea = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const matchesLocalMarket = (product: Product, buyerArea: string, buyerLocation: string) => {
  const storeArea = normalizeMarketArea(product.storeArea || '');
  if (!storeArea) return false;
  const preferredAreas = buyerArea.split(/[,;·]/).map(normalizeMarketArea).filter(Boolean);
  if (preferredAreas.length) return preferredAreas.some((part) => ` ${storeArea} `.includes(` ${part} `));

  const locationParts = buyerLocation.split(/[,;·]/).map(normalizeMarketArea).filter(Boolean);
  return locationParts.some((part) => ` ${storeArea} `.includes(` ${part} `));
};
const PRODUCT_UNITS = ['kg', 'basket', 'bunch', 'bundle', 'item', 'tuber', 'crate', 'bag', 'sack', 'loaf', 'pack', 'bottle', 'carton', 'tray', 'portion'] as const;
type ProductWithStoreRow = {
  id: string;
  store_id: string;
  name: string;
  price: number;
  unit: string;
  category: string;
  image_url: string | null;
  description: string | null;
  stock_quantity: number;
  is_available: boolean;
  variant_options?: ProductVariant[] | null;
  stores: Array<{ name: string; category: string }> | { name: string; category: string } | null;
};
type MarketplaceProductRow = {
  id: string;
  store_id: string;
  name: string;
  price: number;
  unit: string;
  category: string;
  image_url: string | null;
  description: string | null;
  stock_quantity: number;
  variant_options: ProductVariant[] | null;
  store_name: string;
  store_category: string;
  store_market_area: string;
  store_verified: boolean;
  created_at: string;
};
type AdminIssue = {
  id: string;
  order_id: string;
  buyer_id: string;
  issue_type: string;
  description: string;
  status: string;
  admin_note: string;
  created_at: string;
};
type StoreVerificationRequest = {
  store_id: string;
  store_name: string;
  category: string;
  market_area: string;
  pickup_details: string;
  description: string;
  owner_name: string;
  owner_email: string;
  requested_at: string;
  storefront_photo_path: string | null;
  seller_id_path: string | null;
  storefront_photo_url?: string;
  seller_id_url?: string;
};
type RiderVerificationRequest = {
  verification_id: string;
  rider_id: string;
  rider_name: string;
  rider_email: string;
  plate_number: string;
  plate_photo_path: string | null;
  roadworthiness_photo_path: string | null;
  driver_license_photo_path: string | null;
  requested_at: string;
  plate_photo_url?: string;
  roadworthiness_photo_url?: string;
  driver_license_photo_url?: string;
};
type VerificationPhotoKey = 'storefront' | 'sellerId' | 'plate' | 'roadworthiness' | 'driverLicense';
type VerificationPhoto = { uri: string; base64: string; mimeType: string };
type AdminOrderRow = {
  id: string;
  status: string;
  total: number;
  payment_method: string;
  delivery_address: string;
  created_at: string;
  assigned_delivery_id: string | null;
  buyer_name: string;
  rider_name: string;
  item_count: number;
};
type AdminStoreRow = {
  id: string;
  name: string;
  category: string;
  market_area: string;
  owner_id: string;
  owner_name: string;
  product_count: number;
  verification_status: string;
  created_at: string;
};
type AdminProductRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  stock_quantity: number;
  is_available: boolean;
  created_at: string;
  store_name: string;
  store_id: string;
};
type AdminUserRow = {
  id: string;
  full_name: string;
  role: Role;
  area: string;
  created_at: string;
};
type AdminRiderRow = {
  id: string;
  full_name: string;
  vehicle_type: string;
  is_available: boolean;
  created_at: string;
  verification_status: string;
  plate_number: string | null;
};
type AdminDashboardSnapshot = {
  metrics: {
    buyers: number;
    stores: number;
    pending_verification: number;
    live_orders: number;
    available_riders: number;
    pending_rider_verification: number;
  };
  orders: AdminOrderRow[];
  stores: AdminStoreRow[];
  products: AdminProductRow[];
  users: AdminUserRow[];
  delivery_partners: AdminRiderRow[];
};
type AppNotification = {
  id: string;
  user_id: string;
  order_id: string | null;
  event_type: string;
  event_key: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};
type InventoryAnalytics = {
  product_id: string;
  units_sold_30d: number;
  sales_30d: number;
  last_sold_at: string | null;
};
type RiderHistoryItem = {
  order_id: string;
  status: string;
  delivered_at: string | null;
  delivery_date: string;
  delivery_slot: string;
  total: number;
  payment_method: string;
  remittance_status: string;
  rider_payout: number;
  buyer_confirmed_at: string | null;
};
type CancellationRequest = {
  id: string;
  order_id: string;
  buyer_id: string;
  reason: string;
  status: string;
  admin_note: string;
  created_at: string;
};
type RefundRequest = {
  id: string;
  order_id: string;
  buyer_id: string;
  amount: number;
  status: string;
  provider_reference: string | null;
  admin_note: string;
  created_at: string;
};

function CartProductImage({ imageUrl }: { imageUrl?: string }) {
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    setHasImageError(false);
  }, [imageUrl]);

  return (
    <View style={styles.cartProductImageFrame}>
      {imageUrl && !hasImageError ? (
        <Image
          accessibilityLabel="Product photo"
          onError={() => setHasImageError(true)}
          resizeMode="cover"
          source={{ uri: imageUrl }}
          style={styles.cartProductImage}
        />
      ) : (
        <Ionicons color="#5C7FA9" name="image-outline" size={25} />
      )}
    </View>
  );
}

function StoreVerifiedMark() {
  return (
    <View style={styles.storeVerifiedMark}>
      <Ionicons color="#0F6B46" name="checkmark-circle" size={14} />
      <Text style={styles.storeVerifiedText}>Verified</Text>
    </View>
  );
}

function AdminStatusPill({ label }: { label: string }) {
  const normalizedLabel = label.toLowerCase();
  const isPositive = ['verified', 'completed', 'available', 'listed', 'ready'].includes(normalizedLabel);
  const isPending = ['pending', 'pending review', 'preparing', 'accepted'].includes(normalizedLabel);
  return (
    <View style={[styles.adminStatusPill, isPositive ? styles.adminStatusPositive : isPending ? styles.adminStatusPending : styles.adminStatusNeutral]}>
      <Text style={[styles.adminStatusText, isPositive ? styles.adminStatusPositiveText : isPending ? styles.adminStatusPendingText : styles.adminStatusNeutralText]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function VerificationPhotoPicker({
  label,
  photo,
  onPress,
}: {
  label: string;
  photo?: VerificationPhoto;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.verificationPhotoPicker}>
      {photo ? (
        <Image accessibilityLabel={label} source={{ uri: photo.uri }} style={styles.verificationPhotoPreview} />
      ) : (
        <View style={styles.verificationPhotoPlaceholder}>
          <Ionicons color="#1D4E89" name="camera-outline" size={23} />
        </View>
      )}
      <View style={styles.verificationPhotoCopy}>
        <Text style={styles.verificationPhotoLabel}>{label}</Text>
        <Text style={styles.verificationPhotoAction}>{photo ? 'Photo added · tap to change' : 'Add photo'}</Text>
      </View>
      <Ionicons color="#536A86" name={photo ? 'checkmark-circle' : 'add-circle-outline'} size={21} />
    </Pressable>
  );
}

function RiderMap({ location }: { location: RiderLocation }) {
  const webViewRef = useRef<WebView<{}>>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const initialHtml = useRef(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>html,body,#map{height:100%;margin:0} .leaflet-control-attribution{font-size:10px}</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([${location.latitude},${location.longitude}], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const riderMarker = L.marker([${location.latitude},${location.longitude}]).addTo(map);
    riderMarker.bindPopup('Delivery rider');
    window.updateRiderLocation = function(latitude, longitude) {
      const position = [latitude, longitude];
      riderMarker.setLatLng(position);
      map.setView(position, map.getZoom());
    };
  </script>
</body>
</html>`).current;

  useEffect(() => {
    if (!mapLoaded) return;
    webViewRef.current?.injectJavaScript(
      `window.updateRiderLocation(${location.latitude},${location.longitude}); true;`,
    );
  }, [location.latitude, location.longitude, mapLoaded]);

  if (mapError) {
    return (
      <View style={[styles.riderMap, styles.riderMapError]}>
        <Text style={styles.deliveryEmptyText}>The map could not be loaded. Check your internet connection and try again.</Text>
      </View>
    );
  }

  return (
    <WebView<{}> ref={webViewRef}
      originWhitelist={['*']}
      onLoadEnd={() => setMapLoaded(true)}
      onError={() => setMapError(true)}
      onHttpError={() => setMapError(true)}
      javaScriptEnabled
      source={{ html: initialHtml }}
      style={styles.riderMap}
    />
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

async function getCurrentAuthenticatedUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.user) return null;
  const { data: authData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  return authData.user;
}

function getDeliveryLocationError(error: unknown) {
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const message = getErrorMessage(error, '');
  const normalizedMessage = message.toLowerCase();

  if (
    errorCode === '42P01'
    || errorCode === 'PGRST205'
    || normalizedMessage.includes('delivery_order_locations')
      && (normalizedMessage.includes('schema cache') || normalizedMessage.includes('does not exist'))
  ) {
    return 'Rider tracking is not set up in Supabase yet. Apply the delivery-location migration, then restart the app.';
  }
  if (errorCode === '42501' || normalizedMessage.includes('row-level security')) {
    return 'Supabase blocked location sharing. Confirm this rider is assigned to the order and its status is out for delivery.';
  }
  return message || 'Unable to publish rider location. Check location permission and your connection.';
}

function parsePriceAmount(price: string) {
  const amount = Number(price.replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getProductUnitPrice(product: Product) {
  return parsePriceAmount(product.price);
}

function getCartLineUnitPrice(line: CartLine) {
  return line.variant?.price ?? getProductUnitPrice(line.product);
}

function getCartSubtotal(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + getCartLineUnitPrice(line) * line.quantity, 0);
}

function getCartCount(lines: CartLine[]) {
  return lines.length;
}

function isKubwaDeliveryAddress(address: string) {
  return address.toLowerCase().includes('kubwa');
}

function getDeliveryFee(address: string) {
  return isKubwaDeliveryAddress(address) ? 1000 : 2000;
}

function getDeliveryWindowLabel(slot: string) {
  if (slot === 'morning') return '8am–12pm';
  if (slot === 'afternoon') return '12pm–4pm';
  if (slot === 'evening') return '4pm–8pm';
  return slot;
}

function getLagosDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  const date = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + offsetDays, 12));
  return date.toISOString().slice(0, 10);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function mapMarketplaceProductRow(product: MarketplaceProductRow): Product {
  return {
    id: product.id,
    storeId: product.store_id,
    storeArea: product.store_market_area,
    name: product.name,
    store: product.store_name || 'Local seller',
    storeCategory: product.store_category,
    price: `${formatCurrency(Number(product.price))} / ${product.unit}`,
    category: product.category,
    imageUrl: product.image_url || undefined,
    description: product.description || undefined,
    quantity: String(product.stock_quantity),
    unit: product.unit,
    variants: product.variant_options || [],
    isAvailable: true,
    storeVerified: product.store_verified,
  };
}

function AppContent() {
  const isSupabaseConfigured = Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_URL &&
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  );
  const [showSplash, setShowSplash] = useState(true);
  const [screen, setScreen] = useState<Screen>('welcome');
  const [role, setRole] = useState<Role | null>('buyer');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isGuestBrowsing, setIsGuestBrowsing] = useState(false);
  const [hasRegisteredAccount, setHasRegisteredAccount] = useState(false);
  const [termsReturnScreen, setTermsReturnScreen] = useState<Screen>('welcome');
  const [rememberLogin, setRememberLogin] = useState(false);
  const [name, setName] = useState('');
  const [profilePhotoPath, setProfilePhotoPath] = useState<string | null>(null);
  const [profilePhotoVersion, setProfilePhotoVersion] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupPhone, setSignupPhone] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [signupNotice, setSignupNotice] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [location, setLocation] = useState('');
  const [area, setArea] = useState('');
  const [directions, setDirections] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeCategory, setStoreCategory] = useState('');
  const [storeArea, setStoreArea] = useState('');
  const [pickupDetails, setPickupDetails] = useState('');
  const [storeDescription, setStoreDescription] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [verifiedStoresOnly, setVerifiedStoresOnly] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedCartKeys, setSelectedCartKeys] = useState<Set<string>>(new Set());
  const [selectedProductVariantId, setSelectedProductVariantId] = useState<string | null>(null);
  const [customProductQuantity, setCustomProductQuantity] = useState('');
  const [isPromoSheetVisible, setIsPromoSheetVisible] = useState(false);
  const [productDetail, setProductDetail] = useState<Product | null>(null);
  const [productDetailReturnScreen, setProductDetailReturnScreen] = useState<Screen>('dashboard');
  const [storefrontReturnScreen, setStorefrontReturnScreen] = useState<Screen>('productDetail');
  const [storefrontReviews, setStorefrontReviews] = useState<PublicStoreReview[]>([]);
  const [isLoadingStorefrontReviews, setIsLoadingStorefrontReviews] = useState(false);
  const [storefrontReviewsError, setStorefrontReviewsError] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [saved, setSaved] = useState<Product[]>([]);
  const [deliverySlot, setDeliverySlot] = useState<'morning' | 'afternoon' | 'evening'>('morning');
  const [deliveryDate, setDeliveryDate] = useState(() => getLagosDate());
  const [cancellationReasons, setCancellationReasons] = useState<Record<string, string>>({});
  const [cancellationRequests, setCancellationRequests] = useState<CancellationRequest[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState('');
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [sellerPromoCode, setSellerPromoCode] = useState('');
  const [sellerPromoActive, setSellerPromoActive] = useState(false);
  const [isSavingPromo, setIsSavingPromo] = useState(false);
  const [productStockAlertIds, setProductStockAlertIds] = useState<Set<string>>(new Set());
  const [marketplaceAlerts, setMarketplaceAlerts] = useState<MarketplaceAlert[]>([]);
  const [riderPhone, setRiderPhone] = useState('');
  const [riderSharesPhone, setRiderSharesPhone] = useState(false);
  const [isSavingRiderPhone, setIsSavingRiderPhone] = useState(false);
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const [chatOrderId, setChatOrderId] = useState('');
  const [chatReturnScreen, setChatReturnScreen] = useState<Screen>('orders');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState('');
  const [isCallingRider, setIsCallingRider] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'card' | 'cash_on_delivery'>('cash_on_delivery');
  const [usePaymentSimulator, setUsePaymentSimulator] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [isConfirmingReceived, setIsConfirmingReceived] = useState(false);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const [paymentCheckMessage, setPaymentCheckMessage] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<'Available' | 'Offline'>('Offline');
  const [inventory, setInventory] = useState<Product[]>([]);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductImage, setNewProductImage] = useState<string | null>(null);
  const [newProductImageBase64, setNewProductImageBase64] = useState<string | null>(null);
  const [newProductImageMimeType, setNewProductImageMimeType] = useState('image/jpeg');
  const [newProductQuantity, setNewProductQuantity] = useState('');
  const [newProductVariants, setNewProductVariants] = useState<ProductVariantDraft[]>([]);
  const [newProductUnit, setNewProductUnit] = useState('kg');
  const [newProductCategory, setNewProductCategory] = useState('Produce');
  const [newProductDescription, setNewProductDescription] = useState('');
  const [newProductAvailable, setNewProductAvailable] = useState(true);
  const [bulkProductDrafts, setBulkProductDrafts] = useState<BulkProductDraft[]>([]);
  const [bulkProductError, setBulkProductError] = useState('');
  const [isSavingBulkProducts, setIsSavingBulkProducts] = useState(false);
  const [serviceArea, setServiceArea] = useState('');
  const [isGettingCurrentLocation, setIsGettingCurrentLocation] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [inventoryAnalytics, setInventoryAnalytics] = useState<InventoryAnalytics[]>([]);
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({});
  const [isSavingBulkStock, setIsSavingBulkStock] = useState(false);
  const [sellerReviews, setSellerReviews] = useState<Array<{ rating: number; review: string; created_at: string }>>([]);
  const [submittingSubstitutionId, setSubmittingSubstitutionId] = useState('');
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: number; review: string }>>({});
  const [submittingReviewKey, setSubmittingReviewKey] = useState('');
  const [issueType, setIssueType] = useState('missing_item');
  const [issueDescription, setIssueDescription] = useState('');
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [adminIssues, setAdminIssues] = useState<AdminIssue[]>([]);
  const [adminIssueNotes, setAdminIssueNotes] = useState<Record<string, string>>({});
  const [adminCancellationRequests, setAdminCancellationRequests] = useState<CancellationRequest[]>([]);
  const [adminRefundRequests, setAdminRefundRequests] = useState<RefundRequest[]>([]);
  const [adminCancellationNotes, setAdminCancellationNotes] = useState<Record<string, string>>({});
  const [adminRefundDrafts, setAdminRefundDrafts] = useState<Record<string, { status: string; reference: string; note: string }>>({});
  const [adminSnapshot, setAdminSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [adminTab, setAdminTab] = useState<'overview' | 'orders' | 'stores' | 'products' | 'people' | 'issues'>('overview');
  const [adminSearch, setAdminSearch] = useState('');
  const [isLoadingAdminSnapshot, setIsLoadingAdminSnapshot] = useState(false);
  const [adminProductBusyId, setAdminProductBusyId] = useState<string | null>(null);
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [riderVerificationRequests, setRiderVerificationRequests] = useState<RiderVerificationRequest[]>([]);
  const [isSubmittingVerification, setIsSubmittingVerification] = useState(false);
  const [verificationPhotos, setVerificationPhotos] = useState<Partial<Record<VerificationPhotoKey, VerificationPhoto>>>({});
  const [riderPlateNumber, setRiderPlateNumber] = useState('');
  const [riderVerificationStatus, setRiderVerificationStatus] = useState<'unverified' | 'pending' | 'verified' | 'rejected'>('unverified');
  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [riderRemittances, setRiderRemittances] = useState<Record<string, RiderRemittance>>({});
  const [collectionAccount, setCollectionAccount] = useState<CollectionAccount | null>(null);
  const [remittanceReferences, setRemittanceReferences] = useState<Record<string, string>>({});
  const [submittingRemittanceId, setSubmittingRemittanceId] = useState('');
  const [deliveryProofDrafts, setDeliveryProofDrafts] = useState<Record<string, DeliveryProofDraft>>({});
  const [submittingDeliveryProofId, setSubmittingDeliveryProofId] = useState('');
  const [payoutBankName, setPayoutBankName] = useState('');
  const [payoutAccountName, setPayoutAccountName] = useState('');
  const [payoutAccountNumber, setPayoutAccountNumber] = useState('');
  const [isSavingPayoutAccount, setIsSavingPayoutAccount] = useState(false);
  const [payoutHistory, setPayoutHistory] = useState<PayoutHistoryItem[]>([]);
  const [riderHistory, setRiderHistory] = useState<RiderHistoryItem[]>([]);
  const [sellerPayoutSummary, setSellerPayoutSummary] = useState<SellerPayoutSummary | null>(null);
  const [riderPayoutSummary, setRiderPayoutSummary] = useState<RiderPayoutSummary | null>(null);
  const [deliveryTab, setDeliveryTab] = useState<'assignments' | 'completed'>('assignments');
  const [dashboardNotice, setDashboardNotice] = useState('');
  const [expandedSupportQuestion, setExpandedSupportQuestion] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationError, setNotificationError] = useState('');
  const [pushSetupNotice, setPushSetupNotice] = useState('');
  const [isHydrated, setIsHydrated] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [remoteProducts, setRemoteProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isLoadingMoreProducts, setIsLoadingMoreProducts] = useState(false);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [marketplaceCursor, setMarketplaceCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [debouncedMarketplaceSearch, setDebouncedMarketplaceSearch] = useState('');
  const [marketError, setMarketError] = useState('');
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [riderLocation, setRiderLocation] = useState<RiderLocation | null>(null);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [isSavingStore, setIsSavingStore] = useState(false);
  const [sellerStoreId, setSellerStoreId] = useState<string | null>(null);
  const [storeVerificationStatus, setStoreVerificationStatus] = useState<'unverified' | 'pending' | 'verified' | 'rejected'>('unverified');
  const [verificationRequests, setVerificationRequests] = useState<StoreVerificationRequest[]>([]);
  const [isReviewingVerification, setIsReviewingVerification] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingProfilePhoto, setIsUploadingProfilePhoto] = useState(false);
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isBiometricBusy, setIsBiometricBusy] = useState(false);
  const authCallbackInFlight = useRef(false);
  const processedAuthUrls = useRef(new Set<string>());
  const pendingOAuthRole = useRef<{ role: Role; isSignup: boolean; phoneNumber: string } | null>(null);
  const sessionRestoreStarted = useRef(false);
  const checkoutAfterAuth = useRef(false);
  const currentScreen = useRef(screen);
  const marketplaceRequestId = useRef(0);
  const loadingMoreMarketplaceRef = useRef(false);

  useEffect(() => {
    currentScreen.current = screen;
  }, [screen]);

  useEffect(() => {
    publishAppNavigation({
      screen,
      role,
      isGuestBrowsing,
      cartCount: getCartCount(cart),
      navigate: setScreen,
    });
  }, [cart, isGuestBrowsing, role, screen]);

  const rememberRegisteredAccount = async () => {
    setHasRegisteredAccount(true);
    try {
      await AsyncStorage.setItem('getbuy-has-registered', 'true');
    } catch (error: unknown) {
      console.error('Unable to remember this registered account on the device.', error);
      setAuthError('Your account is registered, but this device could not save the sign-in preference.');
    }
  };

  const saveRememberedLogin = async (emailAddress: string) => {
    try {
      if (rememberLogin && emailAddress.trim()) {
        await AsyncStorage.setItem('getbuy-remembered-email', emailAddress.trim());
      } else {
        await AsyncStorage.removeItem('getbuy-remembered-email');
      }
    } catch (error: unknown) {
      console.error('Unable to update the remembered sign-in email.', error);
      setAuthError('Unable to save your sign-in preference on this device.');
    }
  };

  const toggleRememberLogin = async () => {
    const shouldRemember = !rememberLogin;
    setRememberLogin(shouldRemember);
    if (!shouldRemember) {
      try {
        await AsyncStorage.removeItem('getbuy-remembered-email');
      } catch (error: unknown) {
        console.error('Unable to remove the remembered sign-in email.', error);
        setAuthError('Unable to clear the remembered email from this device.');
      }
    } else if (email.trim()) {
      try {
        await AsyncStorage.setItem('getbuy-remembered-email', email.trim());
      } catch (error: unknown) {
        console.error('Unable to remember the sign-in email.', error);
        setAuthError('Unable to save your sign-in preference on this device.');
      }
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1700);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('getbuy-state'),
      AsyncStorage.getItem('getbuy-has-registered'),
      AsyncStorage.getItem('getbuy-remembered-email'),
    ]).then(([value, registeredValue, rememberedEmail]) => {
      if (rememberedEmail) {
        setEmail(rememberedEmail);
        setRememberLogin(true);
      }
      if (registeredValue === 'true') {
        setHasRegisteredAccount(true);
        setRole(null);
        setScreen('signin');
      }
      if (value) {
        try {
          const savedState = JSON.parse(value) as {
            name?: string;
            email?: string;
            location?: string;
            area?: string;
            directions?: string;
            storeName?: string;
            storeCategory?: string;
            storeArea?: string;
            pickupDetails?: string;
            storeDescription?: string;
            saved?: Product[];
            cart?: Array<CartLine | Product>;
            biometricEnabled?: boolean;
          };
          if (savedState.location) setLocation(savedState.location);
          if (savedState.area) setArea(savedState.area);
          if (savedState.directions) setDirections(savedState.directions);
          if (savedState.storeName) setStoreName(savedState.storeName);
          if (savedState.storeCategory) setStoreCategory(savedState.storeCategory);
          if (savedState.storeArea) setStoreArea(savedState.storeArea);
          if (savedState.pickupDetails) setPickupDetails(savedState.pickupDetails);
          if (savedState.storeDescription) setStoreDescription(savedState.storeDescription);
          if (savedState.saved) setSaved(savedState.saved);
          if (savedState.cart) {
            const restoredByKey = new Map<string, CartLine>();
            savedState.cart.forEach((entry) => {
              if ('product' in entry) {
                restoredByKey.set(entry.key, entry);
                return;
              }
              const key = `${entry.id || 'legacy'}:base`;
              const existing = restoredByKey.get(key);
              restoredByKey.set(key, existing
                ? { ...existing, quantity: existing.quantity + 1 }
                : { key, product: entry, quantity: 1, customQuantity: false });
            });
            const restoredCart = [...restoredByKey.values()];
            setCart(restoredCart);
            setSelectedCartKeys(new Set(restoredCart.map((line) => line.key)));
          }
          if (savedState.biometricEnabled) setBiometricEnabled(true);
        } catch (error: unknown) {
          console.warn('Saved GetBuy state is invalid and was ignored.', error);
          AsyncStorage.removeItem('getbuy-state').catch(() => undefined);
        }
      }
      setIsHydrated(true);
    }).catch((error: unknown) => {
      console.warn('GetBuy persistence is unavailable in this runtime. Using session memory instead.', error);
      setStorageAvailable(false);
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!isHydrated || !storageAvailable) return;
    AsyncStorage.setItem('getbuy-state', JSON.stringify({
      location,
      area,
      directions,
      storeName,
      storeCategory,
      storeArea,
      pickupDetails,
      storeDescription,
      saved,
      cart,
      biometricEnabled,
    })).catch((error: unknown) => {
      console.error('Unable to save GetBuy state.', error);
    });
  }, [area, biometricEnabled, cart, directions, isHydrated, location, pickupDetails, saved, storageAvailable, storeArea, storeCategory, storeDescription, storeName]);

  useEffect(() => {
    if (!isHydrated || sessionRestoreStarted.current || !process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return;
    sessionRestoreStarted.current = true;

    let active = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        console.warn('Unable to restore the Supabase session.', error);
        return;
      }
      const sessionUser = data.session?.user;
      if (!active || !sessionUser) return;
      await rememberRegisteredAccount();
      if (biometricEnabled && Platform.OS !== 'web') {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock your saved GetBuy session',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        });
        if (!result.success) {
          setAuthError('Unlock with Face ID, fingerprint, or your device passcode to continue. You can also sign in with your password.');
          setScreen('signin');
          return;
        }
      }
      const metadata = sessionUser.user_metadata as { full_name?: string; role?: Role };
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sessionUser.id)
        .single();
      if (profileError) {
        console.warn('Unable to load the signed-in profile.', profileError);
        return;
      }
      const restoredRole = (profile.role || metadata.role) as Role | undefined;
      setEmail(sessionUser.email || '');
      setName(profile.full_name || metadata.full_name || '');
      setSignupPhone(profile.phone_number || '');
      setProfilePhotoPath(profile.avatar_path || null);
      setLocation(profile.location || '');
      setArea(profile.area || '');
      setDirections(profile.directions || '');
      if (restoredRole === 'delivery') setServiceArea(profile.area || profile.location || '');
      if (restoredRole) {
        setRole(restoredRole);
        if (restoredRole === 'admin') {
          await supabase.auth.signOut();
          setScreen('adminSetup');
        } else {
          setCurrentUserId(sessionUser.id);
          setScreen(restoredRole === 'buyer' ? 'dashboard' : restoredRole === 'seller' ? 'sellerDashboard' : 'deliveryDashboard');
        }
      }
    }).catch((error: unknown) => {
      console.warn('Unable to restore the Supabase session.', error);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (!session?.user) {
        setCurrentUserId(null);
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryError('');
        setRecoveryNotice('');
        setScreen('newPassword');
      }
      const metadata = session.user.user_metadata as { full_name?: string };
      if (session.user.email) setEmail(session.user.email);
      if (metadata.full_name) setName(metadata.full_name);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [biometricEnabled, isHydrated]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || !currentUserId || isGuestBrowsing) {
      setNotifications([]);
      return;
    }

    let active = true;
    setNotifications([]);
    setNotificationError('');
    const loadNotifications = async () => {
      const { data, error } = await supabase.from('user_notifications')
        .select('id, user_id, order_id, event_type, event_key, title, body, payload, read_at, created_at')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      if (active) setNotifications((data || []) as AppNotification[]);
    };

    loadNotifications().catch((error: unknown) => {
      if (!active) return;
      console.error('Unable to load in-app notifications.', error);
      setNotificationError(getErrorMessage(error, 'Unable to load notifications.'));
    });

    const channel = supabase.channel(`user-notifications-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${currentUserId}`,
      }, (payload) => {
        if (!active) return;
        if (payload.eventType === 'INSERT') {
          const incoming = payload.new as AppNotification;
          setNotifications((current) => [
            incoming,
            ...current.filter((notification) => notification.id !== incoming.id),
          ].slice(0, 100));
          if (currentScreen.current !== 'notifications') {
            setToast(incoming.title);
            setTimeout(() => setToast(''), 3500);
          }
          void supabase.functions.invoke('notify-order-event', {
            body: { event_type: 'dispatch_pending' },
          }).then(({ error }) => {
            if (error) console.warn('Unable to deliver a queued push notification.', error);
          }).catch((error: unknown) => {
            console.warn('Unable to deliver a queued push notification.', error);
          });
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as AppNotification;
          setNotifications((current) => current.map((notification) =>
            notification.id === updated.id ? updated : notification,
          ));
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && active) {
          setNotificationError('In-app alerts are temporarily unavailable.');
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, isGuestBrowsing, isHydrated, isSupabaseConfigured]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || role !== 'buyer'
      || (screen !== 'orders' && screen !== 'tracking')) return;
    let active = true;
    const loadBuyerCancellationAndRefunds = async () => {
      const [{ data: cancellations, error: cancellationsError }, { data: refunds, error: refundsError }] = await Promise.all([
        supabase.from('order_cancellation_requests')
          .select('id, order_id, buyer_id, reason, status, admin_note, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('order_refunds')
          .select('id, order_id, buyer_id, amount, status, provider_reference, admin_note, created_at')
          .order('created_at', { ascending: false }),
      ]);
      if (cancellationsError) throw cancellationsError;
      if (refundsError) throw refundsError;
      if (active) {
        setCancellationRequests((cancellations || []) as CancellationRequest[]);
        setRefundRequests((refunds || []) as RefundRequest[]);
      }
    };
    loadBuyerCancellationAndRefunds().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load cancellation or refund updates.'));
    });
    return () => { active = false; };
  }, [isHydrated, isSupabaseConfigured, role, screen]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || !currentUserId || isGuestBrowsing) return;
    let active = true;

    const registerForPush = async () => {
      if (Platform.OS === 'web') {
        setPushSetupNotice('Push alerts are available in the Android and iOS app.');
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('orders', {
          name: 'Orders and deliveries',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#143A73',
        });
      }

      let permissions = await Notifications.getPermissionsAsync();
      if (!permissions.granted) permissions = await Notifications.requestPermissionsAsync();
      if (!permissions.granted) {
        setPushSetupNotice('Push permission is off. You can still see alerts in the app.');
        return;
      }

      const projectId = Constants.easConfig?.projectId
        || Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        setPushSetupNotice('Push alerts need the app’s EAS project ID. In-app alerts are available.');
        return;
      }

      const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
      const { error } = await supabase.from('notification_push_tokens').upsert({
        user_id: currentUserId,
        expo_push_token: pushToken.data,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,expo_push_token' });
      if (error) throw error;
      const { error: dispatchError } = await supabase.functions.invoke('notify-order-event', {
        body: { event_type: 'dispatch_pending' },
      });
      if (dispatchError) console.warn('Unable to dispatch previously queued push notifications.', dispatchError);
      if (active) setPushSetupNotice('');
    };

    registerForPush().catch((error: unknown) => {
      if (!active) return;
      console.warn('Push notification registration failed.', error);
      setPushSetupNotice('Push registration failed on this device. In-app alerts are still available.');
    });

    const responseSubscription = Platform.OS === 'web'
      ? null
      : Notifications.addNotificationResponseReceivedListener(() => {
        setScreen('notifications');
      });
    if (Platform.OS !== 'web') {
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (active && response) setScreen('notifications');
      }).catch((error: unknown) => {
        console.warn('Unable to read the last notification response.', error);
      });
    }

    return () => {
      active = false;
      responseSubscription?.remove();
    };
  }, [currentUserId, isGuestBrowsing, isHydrated, isSupabaseConfigured]);

  const handleAuthCallback = async (url: string | null | undefined) => {
      if (!url || !url.includes('auth/callback')) return;
      if (processedAuthUrls.current.has(url) || authCallbackInFlight.current) return;
      processedAuthUrls.current.add(url);
      authCallbackInFlight.current = true;
      try {
        const [baseUrl, hash = ''] = url.split('#');
        const query = baseUrl.split('?')[1] || '';
        const params = new URLSearchParams(`${query}&${hash}`);
        const errorDescription = params.get('error_description');
        if (errorDescription) throw new Error(errorDescription.replace(/\+/g, ' '));

        const code = params.get('code');
        let authUserId: string | undefined;
        let authUserMetadata: { full_name?: string; name?: string; role?: Role } = {};
        let authUserEmail = '';
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          authUserId = data.session?.user.id;
          authUserMetadata = (data.session?.user.user_metadata || {}) as typeof authUserMetadata;
          authUserEmail = data.session?.user.email || '';
        } else {
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (!accessToken || !refreshToken) return;
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          authUserId = data.session?.user.id;
          authUserMetadata = (data.session?.user.user_metadata || {}) as typeof authUserMetadata;
          authUserEmail = data.session?.user.email || '';
        }
        if (!authUserId) throw new Error('Authentication completed without an account session.');
        setCurrentUserId(authUserId);
        if (params.get('type') === 'recovery') {
          setEmail(authUserEmail);
          setRecoveryError('');
          setRecoveryNotice('');
          setScreen('newPassword');
          return;
        }

        const oauthIntent = pendingOAuthRole.current;
        let requestedRole: Role | null = null;
        if (oauthIntent?.isSignup && oauthIntent.role !== 'buyer' && oauthIntent.role !== 'admin') {
          const { error } = await supabase.rpc('set_oauth_signup_role', { p_role: oauthIntent.role });
          if (error) throw error;
          requestedRole = oauthIntent.role;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUserId)
          .single();
        if (profileError) throw profileError;
        const profileName = profile.full_name || authUserMetadata.full_name || authUserMetadata.name || '';
        if (!profile.full_name && profileName) {
          const { error: nameError } = await supabase.from('profiles')
            .update({ full_name: profileName })
            .eq('id', authUserId);
          if (nameError) throw nameError;
        }
        if (oauthIntent?.isSignup && (oauthIntent.role === 'buyer' || oauthIntent.role === 'seller' || oauthIntent.role === 'delivery')) {
          if (oauthIntent.phoneNumber.replace(/\D/g, '').length < 10) {
            throw new Error('Enter a valid phone number on the sign-up screen before creating your account.');
          }
          const { error: phoneError } = await supabase.from('profiles')
            .update({ phone_number: oauthIntent.phoneNumber.trim() })
            .eq('id', authUserId);
          if (phoneError) throw phoneError;
        }
        const confirmedRole = requestedRole || profile.role as Role;
        await rememberRegisteredAccount();
        if (confirmedRole === 'admin') {
          await supabase.auth.signOut();
          setRole('admin');
          setScreen('adminSetup');
          return;
        }
        setEmail(authUserEmail);
        setName(profileName);
        setSignupPhone(profile.phone_number || (oauthIntent?.isSignup ? oauthIntent.phoneNumber : '') || '');
        setProfilePhotoPath(profile.avatar_path || null);
        setLocation(profile.location || '');
        setArea(profile.area || '');
        setDirections(profile.directions || '');
        if (confirmedRole === 'delivery') setServiceArea(profile.area || profile.location || '');
        setAuthError('');
        pendingOAuthRole.current = null;
        setRole(confirmedRole);
        setIsGuestBrowsing(false);
        if (checkoutAfterAuth.current && confirmedRole === 'buyer') {
          checkoutAfterAuth.current = false;
          setScreen('checkout');
        } else {
          checkoutAfterAuth.current = false;
          setScreen(confirmedRole === 'seller' ? 'sellerDashboard' : confirmedRole === 'delivery' ? 'deliveryDashboard' : 'dashboard');
        }
      } catch (error: unknown) {
        processedAuthUrls.current.delete(url);
        pendingOAuthRole.current = null;
        setAuthError(getErrorMessage(error, 'Unable to complete sign in.'));
        setScreen('signin');
      } finally {
        authCallbackInFlight.current = false;
      }
  };

  useEffect(() => {
    Linking.getInitialURL().then(handleAuthCallback).catch((error: unknown) => {
      console.warn('Unable to process the GetBuy confirmation link.', error);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleAuthCallback(url).catch((error: unknown) => {
        console.warn('Unable to process the GetBuy confirmation link.', error);
      });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMarketplaceSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || screen !== 'dashboard') return;

    let active = true;
    const requestId = ++marketplaceRequestId.current;
    loadingMoreMarketplaceRef.current = false;
    setIsLoadingMoreProducts(false);
    setIsLoadingProducts(true);
    setMarketError('');
    setRemoteProducts([]);
    setMarketplaceCursor(null);
    setHasMoreProducts(false);

    const loadMarketplacePage = async () => {
      if (!area.trim() && !location.trim()) return;
      const { data, error } = await supabase.rpc('get_nearby_marketplace_products', {
        p_area: area.trim() || location.trim(),
        p_search: debouncedMarketplaceSearch,
        p_category: category,
        p_verified_only: verifiedStoresOnly,
        p_limit: MARKETPLACE_PAGE_SIZE + 1,
        p_after_created_at: null,
        p_after_id: null,
      });
      if (error) throw error;
      if (!active || marketplaceRequestId.current !== requestId) return;

      const rows = (data || []) as MarketplaceProductRow[];
      const page = rows.slice(0, MARKETPLACE_PAGE_SIZE);
      setRemoteProducts(page.map(mapMarketplaceProductRow));
      const cursorRow = page[page.length - 1];
      setMarketplaceCursor(cursorRow ? { createdAt: cursorRow.created_at, id: cursorRow.id } : null);
      setHasMoreProducts(rows.length > MARKETPLACE_PAGE_SIZE);
    };

    loadMarketplacePage().catch((error: unknown) => {
      if (active && marketplaceRequestId.current === requestId) {
        setMarketError(getErrorMessage(error, 'Unable to load nearby products.'));
        console.error('Unable to load nearby products.', error);
      }
    }).finally(() => {
      if (active && marketplaceRequestId.current === requestId) setIsLoadingProducts(false);
    });

    return () => {
      active = false;
      if (marketplaceRequestId.current === requestId) marketplaceRequestId.current += 1;
    };
  }, [area, category, debouncedMarketplaceSearch, isHydrated, isSupabaseConfigured, location, screen, verifiedStoresOnly]);

  const loadMoreMarketplaceProducts = async () => {
    if (loadingMoreMarketplaceRef.current || !hasMoreProducts || !isSupabaseConfigured) return;
    loadingMoreMarketplaceRef.current = true;
    setIsLoadingMoreProducts(true);
    setMarketError('');
    const requestId = marketplaceRequestId.current;
    try {
      const { data, error } = await supabase.rpc('get_nearby_marketplace_products', {
        p_area: area.trim() || location.trim(),
        p_search: debouncedMarketplaceSearch,
        p_category: category,
        p_verified_only: verifiedStoresOnly,
        p_limit: MARKETPLACE_PAGE_SIZE + 1,
        p_after_created_at: marketplaceCursor?.createdAt || null,
        p_after_id: marketplaceCursor?.id || null,
      });
      if (error) throw error;
      if (marketplaceRequestId.current !== requestId) return;

      const rows = (data || []) as MarketplaceProductRow[];
      const page = rows.slice(0, MARKETPLACE_PAGE_SIZE);
      setRemoteProducts((current) => {
        const existingIds = new Set(current.map((product) => product.id));
        return [...current, ...page.map(mapMarketplaceProductRow).filter((product) => !existingIds.has(product.id))];
      });
      const cursorRow = page[page.length - 1];
      if (cursorRow) setMarketplaceCursor({ createdAt: cursorRow.created_at, id: cursorRow.id });
      setHasMoreProducts(rows.length > MARKETPLACE_PAGE_SIZE);
    } catch (error: unknown) {
      if (marketplaceRequestId.current === requestId) {
        setMarketError(getErrorMessage(error, 'Unable to load more products.'));
        console.error('Unable to load more marketplace products.', error);
      }
    } finally {
      if (marketplaceRequestId.current === requestId) {
        loadingMoreMarketplaceRef.current = false;
        setIsLoadingMoreProducts(false);
      }
    }
  };

  useEffect(() => {
    const storeId = productDetail?.storeId;
    if ((screen !== 'storefront' && screen !== 'productDetail') || !storeId || !isSupabaseConfigured) return;
    let active = true;
    const loadPublicStoreReviews = async () => {
      setIsLoadingStorefrontReviews(true);
      setStorefrontReviewsError('');
      const { data, error } = await supabase.rpc('get_public_store_reviews', { p_store_id: storeId });
      if (error) throw error;
      if (!active) return;
      setStorefrontReviews((data || []) as PublicStoreReview[]);
    };
    loadPublicStoreReviews().catch((error: unknown) => {
      if (active) setStorefrontReviewsError(getErrorMessage(error, 'Unable to load store reviews.'));
    }).finally(() => {
      if (active) setIsLoadingStorefrontReviews(false);
    });
    return () => { active = false; };
  }, [isSupabaseConfigured, productDetail?.id, productDetail?.storeId, screen]);

  useEffect(() => {
    if (!isHydrated || role !== 'buyer' || !currentUserId || !isSupabaseConfigured) return;
    let active = true;
    const loadFavorites = async () => {
      const { data: favoriteRows, error: favoriteError } = await supabase
        .from('product_favorites')
        .select('product_id')
        .eq('buyer_id', currentUserId);
      if (favoriteError) throw favoriteError;
      const productIds = (favoriteRows || []).map((favorite) => favorite.product_id);
      const { data: productRows, error: productError } = productIds.length
        ? await supabase.from('products')
          .select('id, store_id, name, price, unit, category, image_url, description, stock_quantity, is_available, variant_options, stores(name, category)')
          .in('id', productIds)
        : { data: [], error: null };
      if (productError) throw productError;
      if (!active) return;
      const favoriteProducts = (productRows || []) as ProductWithStoreRow[];
      setSaved(favoriteProducts.map((product) => ({
        id: product.id,
        storeId: product.store_id,
        name: product.name,
        store: Array.isArray(product.stores) ? product.stores[0]?.name || 'Local seller' : product.stores?.name || 'Local seller',
        storeCategory: Array.isArray(product.stores) ? product.stores[0]?.category : product.stores?.category,
        price: `${formatCurrency(Number(product.price))} / ${product.unit}`,
        category: product.category,
        imageUrl: product.image_url || undefined,
        description: product.description || undefined,
        quantity: String(product.stock_quantity),
        unit: product.unit,
        variants: product.variant_options || [],
        isAvailable: product.is_available,
      })));
    };
    loadFavorites().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load saved products.'));
    });
    return () => { active = false; };
  }, [currentUserId, isHydrated, isSupabaseConfigured, role]);

  useEffect(() => {
    if (!isHydrated || !currentUserId || !isSupabaseConfigured
      || !['dashboard', 'sellerDashboard', 'notifications', 'profile'].includes(screen)) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from('marketplace_alerts')
          .select('id, product_id, alert_type, message, read_at, created_at')
          .order('created_at', { ascending: false })
          .limit(30);
        if (error) throw error;
        if (active) setMarketplaceAlerts((data || []) as MarketplaceAlert[]);
      } catch (error: unknown) {
        if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load marketplace alerts.'));
      }
    })();
    return () => { active = false; };
  }, [currentUserId, isHydrated, isSupabaseConfigured, screen]);

  useEffect(() => {
    if (!isHydrated || role !== 'seller' || !sellerStoreId || !isSupabaseConfigured) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from('store_promos')
          .select('code, active')
          .eq('store_id', sellerStoreId)
          .maybeSingle();
        if (error) throw error;
        if (!active) return;
        setSellerPromoCode(data?.code || '');
        setSellerPromoActive(Boolean(data?.active));
      } catch (error: unknown) {
        if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load your promo code.'));
      }
    })();
    return () => { active = false; };
  }, [isHydrated, isSupabaseConfigured, role, sellerStoreId]);

  useEffect(() => {
    if (!isHydrated || role !== 'delivery' || !currentUserId || !isSupabaseConfigured || screen !== 'profile') return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from('profiles')
          .select('phone_number, rider_phone_sharing')
          .eq('id', currentUserId)
          .single();
        if (error) throw error;
        if (!active) return;
        setRiderPhone(data.phone_number || '');
        setRiderSharesPhone(Boolean(data.rider_phone_sharing));
      } catch (error: unknown) {
        if (active) setAuthError(getErrorMessage(error, 'Unable to load rider call settings.'));
      }
    })();
    return () => { active = false; };
  }, [currentUserId, isHydrated, isSupabaseConfigured, role, screen]);

  useEffect(() => {
    if (!isHydrated || role !== 'buyer' || !currentUserId || !isSupabaseConfigured) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from('product_stock_alerts')
          .select('product_id')
          .eq('buyer_id', currentUserId);
        if (error) throw error;
        if (active) setProductStockAlertIds(new Set((data || []).map((row) => row.product_id)));
      } catch (error: unknown) {
        if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load stock alert settings.'));
      }
    })();
    return () => { active = false; };
  }, [currentUserId, isHydrated, isSupabaseConfigured, role]);

  useEffect(() => {
    if (screen !== 'orderChat' || !chatThreadId || !isSupabaseConfigured) return;
    let active = true;
    const loadMessages = async () => {
      setIsLoadingChat(true);
      setChatError('');
      const { data, error } = await supabase.from('order_chat_messages')
        .select('id, thread_id, sender_id, message, created_at')
        .eq('thread_id', chatThreadId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      if (active) {
        const loadedMessages = (data || []) as ChatMessage[];
        setChatMessages((current) => {
          const messagesById = new Map(loadedMessages.map((message) => [message.id, message]));
          current.forEach((message) => {
            if (!messagesById.has(message.id)) messagesById.set(message.id, message);
          });
          return [...messagesById.values()].sort((first, second) =>
            first.created_at.localeCompare(second.created_at),
          );
        });
      }
    };
    loadMessages().catch((error: unknown) => {
      if (active) setChatError(getErrorMessage(error, 'Unable to load this order chat.'));
    }).finally(() => {
      if (active) setIsLoadingChat(false);
    });
    const channel = supabase.channel(`order-chat-${chatThreadId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'order_chat_messages',
        filter: `thread_id=eq.${chatThreadId}`,
      }, (payload) => {
        if (!active) return;
        const newMessage = payload.new as ChatMessage;
        setChatMessages((current) => current.some((message) => message.id === newMessage.id)
          ? current
          : [...current, newMessage]);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && active) setChatError('Live chat updates are temporarily unavailable. Reopen this chat to refresh.');
      });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [chatThreadId, isSupabaseConfigured, screen]);

  useEffect(() => {
    if (!isHydrated || (role !== 'buyer' && role !== 'admin') || (screen !== 'orders' && screen !== 'dashboard' && screen !== 'tracking')) return;
    let active = true;
    const loadBuyerOrders = async () => {
      setIsLoadingOrders(true);
      setOrdersError('');
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) {
        setOrders([]);
        return;
      }

      type BuyerOrderRow = {
        id: string;
        status: string;
        total: number | string;
        payment_method: string;
        payment_status: string;
        payment_simulated?: boolean;
        delivery_proof_path?: string | null;
        buyer_confirmed_at: string | null;
        delivery_address: string;
        delivery_date?: string;
        delivery_slot?: string;
        promo_code?: string | null;
        promo_discount?: number | string;
        created_at: string;
      };
      const withSimulatorColumn = () => {
        let query = supabase
          .from('orders')
          .select('id, status, total, payment_method, payment_status, payment_simulated, delivery_proof_path, buyer_confirmed_at, delivery_address, delivery_date, delivery_slot, promo_code, promo_discount, created_at')
          .order('created_at', { ascending: false });
        if (role === 'buyer') query = query.eq('buyer_id', userData.id);
        return query;
      };
      const withoutSimulatorColumn = () => {
        let query = supabase
          .from('orders')
          .select('id, status, total, payment_method, payment_status, buyer_confirmed_at, delivery_address, created_at')
          .order('created_at', { ascending: false });
        if (role === 'buyer') query = query.eq('buyer_id', userData.id);
        return query;
      };
      const initialOrderQuery = await withSimulatorColumn();
      let orderRows: BuyerOrderRow[] | null = initialOrderQuery.data;
      let orderError = initialOrderQuery.error;
      if (orderError && (orderError.message.includes('payment_simulated') || orderError.message.includes('delivery_proof_path')
        || orderError.message.includes('delivery_date') || orderError.message.includes('delivery_slot')
        || orderError.message.includes('promo_code') || orderError.message.includes('promo_discount'))
        && (orderError.code === '42703' || orderError.code === 'PGRST204')) {
        const fallback = await withoutSimulatorColumn();
        orderRows = fallback.data;
        orderError = fallback.error;
      }
      if (orderError) throw orderError;
      if (!active || !orderRows?.length) {
        if (active) setOrders([]);
        return;
      }

      const ids = orderRows.map((order) => order.id);
      const { data: itemRows, error: itemError } = await supabase
        .from('order_items')
        .select('id, order_id, product_id, quantity, unit_price, variant_id, variant_label, unit_snapshot, custom_quantity')
        .in('order_id', ids);
      if (itemError) throw itemError;
      const itemIds = (itemRows || []).map((item) => item.id);
      const [
        { data: substitutionRows, error: substitutionsError },
        { data: reviewRows, error: reviewsError },
        { data: issueRows, error: issuesError },
      ] = await Promise.all([
        itemIds.length
          ? supabase.from('order_item_substitutions').select('order_item_id, substitute_product_id, status').in('order_item_id', itemIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('store_reviews').select('order_id, store_id, rating, review').in('order_id', ids),
        supabase.from('order_issues').select('id, order_id, issue_type, description, status, admin_note, created_at').in('order_id', ids).order('created_at', { ascending: false }),
      ]);
      if (substitutionsError) throw substitutionsError;
      if (reviewsError) throw reviewsError;
      if (issuesError) throw issuesError;
      const substitutionByItemId = new Map((substitutionRows || []).map((offer) => [offer.order_item_id, offer]));
      const productIds = [...new Set([
        ...(itemRows || []).map((item) => item.product_id),
        ...(substitutionRows || []).map((offer) => offer.substitute_product_id),
      ])];
      const { data: productRows, error: productError } = productIds.length
        ? await supabase.from('products').select('id, name, unit, category, image_url, store_id').in('id', productIds)
        : { data: [], error: null };
      if (productError) throw productError;
      const storeIds = [...new Set((productRows || []).map((product) => product.store_id))];
      const { data: storeRows, error: storeError } = storeIds.length
        ? await supabase.from('stores').select('id, name').in('id', storeIds)
        : { data: [], error: null };
      if (storeError) throw storeError;
      if (!active) return;

      const productsById = new Map((productRows || []).map((product) => [product.id, product]));
      const storesById = new Map((storeRows || []).map((store) => [store.id, store.name]));
      const ordersWithProof = await Promise.all(orderRows.map(async (order) => {
        const proofPath = 'delivery_proof_path' in order ? order.delivery_proof_path : null;
        let deliveryProofUrl: string | undefined;
        if (proofPath) {
          const { data: signedUrl, error: signedUrlError } = await supabase.storage
            .from('delivery-proofs')
            .createSignedUrl(proofPath, 3600);
          if (signedUrlError) throw signedUrlError;
          deliveryProofUrl = signedUrl.signedUrl;
        }
        return {
        id: order.id,
        dbId: order.id,
        status: order.status,
        total: Number(order.total),
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        paymentSimulated: 'payment_simulated' in order && order.payment_simulated === true,
        deliveryProofUrl,
        buyerConfirmedAt: order.buyer_confirmed_at,
        deliveryAddress: order.delivery_address,
        deliveryDate: order.delivery_date || getLagosDate(),
        deliverySlot: order.delivery_slot || 'flexible',
        promoCode: order.promo_code || null,
        promoDiscount: Number(order.promo_discount || 0),
        createdAt: order.created_at,
        items: (itemRows || []).filter((item) => item.order_id === order.id).map((item) => {
          const product = productsById.get(item.product_id);
          const offer = substitutionByItemId.get(item.id);
          const substitute = offer ? productsById.get(offer.substitute_product_id) : undefined;
          const substituteStore = substitute ? storesById.get(substitute.store_id) || 'Local seller' : '';
          return {
            id: item.product_id,
            orderItemId: item.id,
            orderVariantId: item.variant_id || undefined,
            orderVariantLabel: item.variant_label || undefined,
            orderCustomQuantity: item.custom_quantity === true,
            storeId: product?.store_id,
            name: `${product?.name || 'Product no longer available'}${item.variant_label ? ` · ${item.variant_label}` : ''}`,
            store: product ? storesById.get(product.store_id) || 'Local seller' : '',
            price: `${formatCurrency(Number(item.unit_price))} / ${item.unit_snapshot || product?.unit || 'item'} · Qty ${item.quantity}`,
            category: product?.category || 'General',
            imageUrl: product?.image_url || undefined,
            quantity: String(item.quantity),
            unit: item.unit_snapshot || product?.unit || 'item',
            substitutionOffer: offer && substitute ? {
              status: offer.status,
              product: {
                id: substitute.id,
                storeId: substitute.store_id,
                name: substitute.name,
                store: substituteStore,
                price: `${formatCurrency(Number(item.unit_price))} / ${substitute.unit} · Qty ${item.quantity}`,
                category: substitute.category,
                imageUrl: substitute.image_url || undefined,
                quantity: String(item.quantity),
                unit: substitute.unit,
              },
            } : undefined,
          };
        }),
        reviews: (reviewRows || []).filter((review) => review.order_id === order.id).map((review) => ({
          storeId: review.store_id,
          rating: Number(review.rating),
          review: review.review,
        })),
        issues: (issueRows || []).filter((issue) => issue.order_id === order.id).map((issue) => ({
          id: issue.id,
          issueType: issue.issue_type,
          description: issue.description,
          status: issue.status,
          adminNote: issue.admin_note,
          createdAt: issue.created_at,
        })),
      };
      }));
      if (active) setOrders(ordersWithProof);
    };

    loadBuyerOrders().catch((error: unknown) => {
      if (active) setOrdersError(getErrorMessage(error, 'Unable to load your orders.'));
    }).finally(() => {
      if (active) setIsLoadingOrders(false);
    });
    return () => { active = false; };
  }, [isHydrated, role, screen]);

  useEffect(() => {
    if (role !== 'seller' || !isSupabaseConfigured || screen !== 'sellerDashboard') return;
    let active = true;
    const loadSellerInventory = async () => {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in to load your store inventory.');
      const { data: store, error: storeError } = await supabase.from('stores').select('id, name, market_area, pickup_details').eq('owner_id', userData.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (storeError) throw storeError;
      if (!store) {
        setInventory([]);
        setSellerStoreId(null);
        setStoreVerificationStatus('unverified');
        setDashboardNotice('Set up your store to add and manage listings.');
        return;
      }
      const { data: verification, error: verificationError } = await supabase
        .from('public_store_verification_status')
        .select('status')
        .eq('store_id', store.id)
        .maybeSingle();
      if (verificationError) throw verificationError;
      const { data, error } = await supabase.from('products')
        .select('id, name, price, unit, category, image_url, description, stock_quantity, is_available, variant_options')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!active) return;
      setStoreName(store.name);
      setSellerStoreId(store.id);
      setStoreVerificationStatus(verification?.status || 'unverified');
      setStoreArea(store.market_area || '');
      setPickupDetails(store.pickup_details || '');
      setInventory((data || []).map((product) => ({
        id: product.id,
        name: product.name,
        store: store.name,
        price: `${formatCurrency(Number(product.price))} / ${product.unit}`,
        category: product.category,
        imageUrl: product.image_url || undefined,
        description: product.description || undefined,
        quantity: String(product.stock_quantity),
        unit: product.unit,
        variants: product.variant_options || [],
        isAvailable: product.is_available,
      })));
    };
    loadSellerInventory().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load store inventory.'));
    });
    return () => { active = false; };
  }, [role, screen, isSupabaseConfigured]);

  useEffect(() => {
    if (!isHydrated || role !== 'seller' || !isSupabaseConfigured || screen !== 'sellerDashboard') return;
    let active = true;
    const loadInventoryAnalytics = async () => {
      const { data, error } = await supabase.rpc('get_seller_inventory_analytics');
      if (error) throw error;
      if (active) setInventoryAnalytics((data || []) as InventoryAnalytics[]);
    };
    loadInventoryAnalytics().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load inventory sales analytics.'));
    });
    return () => { active = false; };
  }, [isHydrated, role, screen, isSupabaseConfigured]);

  useEffect(() => {
    if (!isHydrated || role !== 'delivery' || !isSupabaseConfigured || screen !== 'deliveryDashboard') return;
    let active = true;
    const loadRiderHistory = async () => {
      const { data, error } = await supabase.rpc('get_my_delivery_history');
      if (error) throw error;
      if (active) setRiderHistory((data || []) as RiderHistoryItem[]);
    };
    loadRiderHistory().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load completed delivery history.'));
    });
    return () => { active = false; };
  }, [isHydrated, role, screen, isSupabaseConfigured]);

  useEffect(() => {
    if (role !== 'seller' || !isSupabaseConfigured || screen !== 'sellerDashboard') return;
    let active = true;
    const loadSellerOrders = async () => {
      const { data, error } = await supabase.rpc('get_seller_dashboard_orders');
      if (error) throw error;
      if (!active || !data) return;
      const rows = data as SellerDashboardOrderRow[];
      const orderIds = rows.map((order) => order.order_id);
      const { data: slotRows, error: slotsError } = orderIds.length
        ? await supabase.rpc('get_order_delivery_slots', { p_order_ids: orderIds })
        : { data: [], error: null };
      if (slotsError) throw slotsError;
      const deliverySlots = new Map<string, string>(
        ((slotRows || []) as Array<{ order_id: string; delivery_slot: string }>)
          .map((row) => [row.order_id, row.delivery_slot]),
      );
      const { data: dateRows, error: datesError } = orderIds.length
        ? await supabase.from('orders').select('id, delivery_date').in('id', orderIds)
        : { data: [], error: null };
      if (datesError) throw datesError;
      const deliveryDates = new Map<string, string>(
        ((dateRows || []) as Array<{ id: string; delivery_date: string }>).map((row) => [row.id, row.delivery_date]),
      );
      const { data: promoRows, error: promosError } = orderIds.length
        ? await supabase.rpc('get_order_seller_promo_details', { p_order_ids: orderIds })
        : { data: [], error: null };
      if (promosError) throw promosError;
      const sellerPromos = new Map(
        ((promoRows || []) as Array<{ order_id: string; promo_code: string | null; promo_discount: number | string }>)
          .map((row) => [row.order_id, { code: row.promo_code, discount: Number(row.promo_discount) }]),
      );
      const { data: itemRows, error: itemError } = orderIds.length
        ? await supabase.from('order_items')        .select('id, order_id, product_id, quantity, unit_price, variant_id, variant_label, unit_snapshot, custom_quantity').in('order_id', orderIds)
        : { data: [], error: null };
      if (itemError) throw itemError;
      const itemIds = (itemRows || []).map((item) => item.id);
      const [
        { data: products, error: productsError },
        { data: offers, error: offersError },
      ] = await Promise.all([
        itemRows?.length
          ? supabase.from('products').select('id, name, unit').in('id', itemRows.map((item) => item.product_id))
          : Promise.resolve({ data: [], error: null }),
        itemIds.length
          ? supabase.from('order_item_substitutions').select('order_item_id, status').in('order_item_id', itemIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (productsError) throw productsError;
      if (offersError) throw offersError;
      if (!active) return;
      const productNames = new Map((products || []).map((product) => [product.id, product.name]));
      const productUnits = new Map((products || []).map((product) => [product.id, product.unit]));
      const offerStatuses = new Map((offers || []).map((offer) => [offer.order_item_id, offer.status]));
      const mapped = rows.map((order) => ({
        dbId: order.order_id,
        id: `Order #${order.order_id.slice(0, 6)}`,
        items: order.items_summary ? order.items_summary.split('\n') : [],
        orderItems: (itemRows || []).filter((item) => item.order_id === order.order_id).map((item) => ({
          id: item.id,
          productId: item.product_id,
          name: `${productNames.get(item.product_id) || 'Product'}${item.variant_label ? ` · ${item.variant_label}` : ''}`,
          unit: item.unit_snapshot || productUnits.get(item.product_id) || 'item',
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          substitutionStatus: offerStatuses.get(item.id),
        })),
        status: order.status,
        deliveryAddress: order.delivery_address,
        deliveryDate: deliveryDates.get(order.order_id) || getLagosDate(),
        deliverySlot: deliverySlots.get(order.order_id) || 'flexible',
        promoCode: sellerPromos.get(order.order_id)?.code || null,
        promoDiscount: sellerPromos.get(order.order_id)?.discount || 0,
        total: Number(order.total),
        assignedDeliveryId: order.assigned_delivery_id,
      }));
      setSellerOrders(mapped);
      if (sellerStoreId) {
        const { data: reviews, error: reviewsError } = await supabase
          .from('store_reviews')
          .select('rating, review, created_at')
          .eq('store_id', sellerStoreId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (reviewsError) throw reviewsError;
        if (active) setSellerReviews(reviews || []);
      }
    };
    loadSellerOrders().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load seller orders.'));
    });
    return () => { active = false; };
  }, [role, screen, isSupabaseConfigured, sellerStoreId]);

  useEffect(() => {
    if (role !== 'admin' || !isSupabaseConfigured || screen !== 'adminDashboard') return;
    let active = true;
    const loadAdminDashboard = async () => {
      setIsLoadingAdminSnapshot(true);
      setDashboardNotice('');
      const { data, error } = await supabase.rpc('get_admin_dashboard_snapshot');
      if (error) throw error;
      const [
        { data: requests, error: requestsError },
        { data: riderRequests, error: riderRequestsError },
        { data: issues, error: issuesError },
        { data: cancellationRows, error: cancellationsError },
        { data: refundRows, error: refundsError },
      ] = await Promise.all([
        supabase.rpc('get_store_verification_queue'),
        supabase.rpc('get_rider_verification_queue'),
        supabase.from('order_issues').select('id, order_id, buyer_id, issue_type, description, status, admin_note, created_at').order('created_at', { ascending: false }).limit(100),
        supabase.from('order_cancellation_requests')
          .select('id, order_id, buyer_id, reason, status, admin_note, created_at')
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('order_refunds')
          .select('id, order_id, buyer_id, amount, status, provider_reference, admin_note, created_at')
          .order('created_at', { ascending: false }).limit(100),
      ]);
      if (requestsError) throw requestsError;
      if (riderRequestsError) throw riderRequestsError;
      if (issuesError) throw issuesError;
      if (cancellationsError) throw cancellationsError;
      if (refundsError) throw refundsError;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('The admin dashboard returned an invalid marketplace snapshot.');
      }
      const snapshot = data as unknown as AdminDashboardSnapshot;
      if (!snapshot.metrics || !Array.isArray(snapshot.orders) || !Array.isArray(snapshot.stores)
        || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.users)
        || !Array.isArray(snapshot.delivery_partners)) {
        throw new Error('The admin dashboard data is incomplete. Check the Supabase admin migration.');
      }
      const createDocumentUrl = async (path: string | null) => {
        if (!path) return undefined;
        const { data: signedUrl, error: signedUrlError } = await supabase.storage
          .from('verification-documents')
          .createSignedUrl(path, 600);
        if (signedUrlError) throw signedUrlError;
        return signedUrl.signedUrl;
      };
      const signedStoreRequests = await Promise.all(((requests || []) as StoreVerificationRequest[]).map(async (request) => {
        const [storefront, sellerId] = await Promise.all([
          createDocumentUrl(request.storefront_photo_path),
          createDocumentUrl(request.seller_id_path),
        ]);
        return {
          ...request,
          storefront_photo_url: storefront,
          seller_id_url: sellerId,
        };
      }));
      const signedRiderRequests = await Promise.all(((riderRequests || []) as RiderVerificationRequest[]).map(async (request) => {
        const [plate, roadworthiness, license] = await Promise.all([
          createDocumentUrl(request.plate_photo_path),
          createDocumentUrl(request.roadworthiness_photo_path),
          createDocumentUrl(request.driver_license_photo_path),
        ]);
        return {
          ...request,
          plate_photo_url: plate,
          roadworthiness_photo_url: roadworthiness,
          driver_license_photo_url: license,
        };
      }));
      if (!active) return;
      setAdminSnapshot(snapshot);
      setVerificationRequests(signedStoreRequests);
      setRiderVerificationRequests(signedRiderRequests);
      setAdminIssues((issues || []) as AdminIssue[]);
      setAdminCancellationRequests((cancellationRows || []) as CancellationRequest[]);
      setAdminRefundRequests((refundRows || []) as RefundRequest[]);
    };
    loadAdminDashboard().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load marketplace dashboard.'));
    }).finally(() => {
      if (active) setIsLoadingAdminSnapshot(false);
    });
    return () => { active = false; };
  }, [role, screen, isSupabaseConfigured, adminRefreshKey]);

  useEffect(() => {
    if (role !== 'delivery' || !isSupabaseConfigured || screen !== 'deliveryDashboard') return;
    let active = true;
    const loadDeliveryDashboard = async () => {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in to view delivery jobs.');
      const { data: partner, error: partnerError } = await supabase.from('delivery_partners')
        .select('is_available, vehicle_type')
        .eq('id', userData.id)
        .maybeSingle();
      if (partnerError) throw partnerError;
      setDeliveryStatus(partner?.is_available ? 'Available' : 'Offline');
      setVehicle(partner?.vehicle_type || '');
      const { data: verificationRows, error: verificationError } = await supabase.rpc('get_rider_verification_status');
      if (verificationError) throw verificationError;
      const riderVerification = verificationRows?.[0];
      setRiderVerificationStatus(riderVerification?.status || 'unverified');
      setRiderPlateNumber(riderVerification?.plate_number || '');
      const { data, error } = await supabase.rpc('get_delivery_dashboard');
      if (error) throw error;
      const { data: paymentRows, error: paymentError } = await supabase.rpc('get_delivery_payment_details');
      if (paymentError) throw paymentError;
      const { data: remittanceData, error: remittanceError } = await supabase.rpc('get_my_cod_remittances');
      if (remittanceError) throw remittanceError;
      const { data: collectionData, error: collectionError } = await supabase.rpc('get_cod_collection_account');
      if (collectionError) throw collectionError;
      const { data: payoutSummaryData, error: payoutSummaryError } = await supabase.rpc('get_my_rider_payout_summary');
      if (payoutSummaryError) throw payoutSummaryError;
      if (!active) return;
      const deliveryOrderRows = (data || []) as DeliveryDashboardRow[];
      const { data: slotRows, error: slotsError } = deliveryOrderRows.length
        ? await supabase.rpc('get_order_delivery_slots', { p_order_ids: deliveryOrderRows.map((order) => order.id) })
        : { data: [], error: null };
      if (slotsError) throw slotsError;
      const deliverySlots = new Map<string, string>(
        ((slotRows || []) as Array<{ order_id: string; delivery_slot: string }>)
          .map((row) => [row.order_id, row.delivery_slot]),
      );
      const { data: deliveryDateRows, error: deliveryDatesError } = deliveryOrderRows.length
        ? await supabase.from('orders').select('id, delivery_date').in('id', deliveryOrderRows.map((order) => order.id))
        : { data: [], error: null };
      if (deliveryDatesError) throw deliveryDatesError;
      const deliveryDates = new Map<string, string>(
        ((deliveryDateRows || []) as Array<{ id: string; delivery_date: string }>).map((row) => [row.id, row.delivery_date]),
      );
      const paymentByOrderId = new Map(
        ((paymentRows || []) as DeliveryPaymentRow[]).map((payment) => [payment.id, payment]),
      );
      const jobs: DeliveryOrder[] = deliveryOrderRows.map((order) => ({
        id: order.id,
        status: order.status,
        deliveryAddress: order.delivery_address,
        deliveryDate: deliveryDates.get(order.id) || getLagosDate(),
        deliverySlot: deliverySlots.get(order.id) || 'flexible',
        total: Number(order.total),
        paymentMethod: paymentByOrderId.get(order.id)?.payment_method || 'unknown',
        paymentStatus: paymentByOrderId.get(order.id)?.payment_status || 'not_required',
        paymentSimulated: paymentByOrderId.get(order.id)?.payment_simulated === true,
        assignedToCurrent: order.assigned_delivery_id === userData.id,
        buyerName: order.buyer_name || 'Buyer',
        buyerDirections: order.buyer_directions || '',
        pickupDetails: order.pickup_details || 'Pickup details unavailable',
        itemsSummary: order.items_summary || 'Order items unavailable',
        updatedAt: order.updated_at,
      }));
      setDeliveryOrders(jobs);
      setRiderRemittances(Object.fromEntries(
        ((remittanceData || []) as RiderRemittance[]).map((remittance) => [
          remittance.order_id,
          { ...remittance, expected_amount: Number(remittance.expected_amount) },
        ]),
      ));
      setCollectionAccount(collectionData?.[0] || null);
      const payoutSummary = payoutSummaryData?.[0];
      setRiderPayoutSummary(payoutSummary ? {
        earned_today: Number(payoutSummary.earned_today),
        awaiting_reconciliation: Number(payoutSummary.awaiting_reconciliation),
        ready_for_payout: Number(payoutSummary.ready_for_payout),
        paid_to_date: Number(payoutSummary.paid_to_date),
      } : { earned_today: 0, awaiting_reconciliation: 0, ready_for_payout: 0, paid_to_date: 0 });
    };
    loadDeliveryDashboard().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load delivery jobs.'));
    });
    return () => { active = false; };
  }, [role, screen, isSupabaseConfigured]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || !currentUserId || screen !== 'profile' || !['seller', 'delivery'].includes(role || '')) return;
    let active = true;
    const loadPayoutAccount = async () => {
      const [accountResult, historyResult] = await Promise.all([
        supabase.rpc('get_my_payout_account'),
        supabase.rpc('get_my_payout_history'),
      ]);
      if (accountResult.error) throw accountResult.error;
      if (historyResult.error) throw historyResult.error;
      if (!active) return;
      const account = accountResult.data?.[0];
      setPayoutBankName(account?.bank_name || '');
      setPayoutAccountName(account?.account_name || '');
      setPayoutAccountNumber(account?.account_number || '');
      setPayoutHistory(((historyResult.data || []) as PayoutHistoryItem[]).map((item) => ({
        ...item,
        amount: Number(item.amount),
      })));
    };
    loadPayoutAccount().catch((error: unknown) => {
      if (active) setAuthError(getErrorMessage(error, 'Unable to load payout bank details.'));
    });
    return () => { active = false; };
  }, [currentUserId, isHydrated, isSupabaseConfigured, role, screen]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || !currentUserId || role !== 'seller' || screen !== 'sellerDashboard') return;
    let active = true;
    const loadSellerPayoutSummary = async () => {
      const { data, error } = await supabase.rpc('get_my_seller_payout_summary');
      if (error) throw error;
      if (!active) return;
      const summary = data?.[0];
      setSellerPayoutSummary(summary ? {
        awaiting_reconciliation: Number(summary.awaiting_reconciliation),
        ready_for_payout: Number(summary.ready_for_payout),
        paid_to_date: Number(summary.paid_to_date),
      } : { awaiting_reconciliation: 0, ready_for_payout: 0, paid_to_date: 0 });
    };
    loadSellerPayoutSummary().catch((error: unknown) => {
      if (active) setDashboardNotice(getErrorMessage(error, 'Unable to load seller payout balance.'));
    });
    return () => { active = false; };
  }, [currentUserId, isHydrated, isSupabaseConfigured, role, screen]);

  useEffect(() => {
    const activeOrders = deliveryOrders.filter((order) =>
      order.assignedToCurrent && order.status === 'out_for_delivery',
    );
    if (!isHydrated || role !== 'delivery' || screen !== 'deliveryDashboard' || activeOrders.length === 0) return;

    let active = true;
    let locationSubscription: Location.LocationSubscription | null = null;
    const startLocationSharing = async () => {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before sharing your delivery location.');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Location permission is needed to share your position during an active delivery.');
      }

      locationSubscription = await Location.watchPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 15,
      }, (position) => {
        const currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
          updated_at: new Date(position.timestamp).toISOString(),
        };
        void Promise.all(activeOrders.map(async (order) => {
          const { error } = await supabase.from('delivery_order_locations').upsert({
            order_id: order.id,
            rider_id: userData.id,
            ...currentLocation,
          });
          if (error) throw error;
        })).catch((error: unknown) => {
          if (!active) return;
          console.error('Unable to publish active delivery location.', error);
          setDashboardNotice(getDeliveryLocationError(error));
        });
      });
    };

    startLocationSharing().catch((error: unknown) => {
      if (!active) return;
      console.error('Unable to start active delivery location sharing.', error);
      setDashboardNotice(getDeliveryLocationError(error));
    });

    return () => {
      active = false;
      locationSubscription?.remove();
    };
  }, [deliveryOrders, isHydrated, isSupabaseConfigured, role, screen]);

  useEffect(() => {
    if (!isHydrated || !isSupabaseConfigured || role !== 'buyer' || screen !== 'tracking' || !selectedOrder) return;
    if (selectedOrder.status !== 'out_for_delivery') {
      setRiderLocation(null);
      return;
    }

    let active = true;
    const applyLocation = (row: { latitude: number; longitude: number; accuracy_m: number | null; updated_at: string } | null) => {
      if (!row) {
        setRiderLocation(null);
        return;
      }
      setRiderLocation({
        latitude: row.latitude,
        longitude: row.longitude,
        accuracy: row.accuracy_m,
        updatedAt: row.updated_at,
      });
    };

    void (async () => {
      try {
        const { data, error } = await supabase.from('delivery_order_locations')
          .select('latitude, longitude, accuracy_m, updated_at')
          .eq('order_id', selectedOrder.id)
          .maybeSingle();
        if (error) throw error;
        if (active) applyLocation(data);
      } catch (error: unknown) {
        if (active) setOrdersError(getErrorMessage(error, 'Unable to load the rider location.'));
      }
    })();

    const channel = supabase.channel(`delivery-location-${selectedOrder.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'delivery_order_locations',
        filter: `order_id=eq.${selectedOrder.id}`,
      }, (payload) => {
        if (!active) return;
        if (payload.eventType === 'DELETE') {
          applyLocation(null);
          return;
        }
        applyLocation(payload.new as { latitude: number; longitude: number; accuracy_m: number | null; updated_at: string });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && active) {
          setOrdersError('Live rider updates are temporarily unavailable.');
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [isHydrated, isSupabaseConfigured, role, screen, selectedOrder?.id, selectedOrder?.status]);

  const handleSignOut = async () => {
    try {
      await AsyncStorage.removeItem('getbuy-state');
      if (isSupabaseConfigured) {
        const userData = await getCurrentAuthenticatedUser().catch((error: unknown) => {
          console.warn('Unable to verify the current user before cleaning up push tokens.', error);
          return null;
        });
        if (userData) {
          const { error: tokenError } = await supabase.from('notification_push_tokens')
            .delete()
            .eq('user_id', userData.id);
          if (tokenError) console.warn('Unable to remove push tokens while signing out.', tokenError);
        }
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } catch (error: unknown) {
      setDashboardNotice(error instanceof Error ? error.message : 'Unable to sign out completely.');
    }
    setRole(null);
    setCurrentUserId(null);
    setNotifications([]);
    setName('');
    setPayoutHistory([]);
    setPayoutBankName('');
    setPayoutAccountName('');
    setPayoutAccountNumber('');
    setCollectionAccount(null);
    setProfilePhotoPath(null);
    setProfilePhotoVersion(0);
    setEmail('');
    setLocation('');
    setArea('');
    setDirections('');
    setStoreName('');
    setStoreCategory('');
    setStoreArea('');
    setPickupDetails('');
    setStoreDescription('');
    setServiceArea('');
    setVehicle('');
    setSaved([]);
    setCart([]);
    setSelectedCartKeys(new Set());
    setOrders([]);
    setInventory([]);
    setSellerOrders([]);
    setIsEditingProfile(false);
    setBiometricEnabled(false);
    setScreen(hasRegisteredAccount ? 'signin' : 'welcome');
  };

  const saveProfileName = async () => {
    setAuthError('');
    if (!name.trim()) {
      setAuthError('Enter your name before saving.');
      return;
    }
    if (!isSupabaseConfigured) {
      setAuthError('Saving profile details requires Supabase configuration.');
      return;
    }
    setIsSavingProfile(true);
    try {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before updating your profile.');
      const { error } = await supabase.from('profiles')
        .update({ full_name: name.trim() })
        .eq('id', userData.id);
      if (error) throw error;
      notify('Profile name updated');
      setIsEditingProfile(false);
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to save profile details.'));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const chooseProfilePhoto = async () => {
    setAuthError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access to choose a profile picture.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        base64: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.base64) throw new Error('Could not read the selected photo. Please choose it again.');
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Choose a JPG, PNG, or WebP profile picture.');
      }
      if (asset.base64.length > 7_000_000) throw new Error('Choose a profile picture smaller than 5 MB.');

      setIsUploadingProfilePhoto(true);
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before updating your profile picture.');
      const binary = atob(asset.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const path = `${userData.id}/avatar`;
      const { error: uploadError } = await supabase.storage.from('profile-photos').upload(path, bytes.buffer, {
        contentType: mimeType,
        upsert: true,
      });
      if (uploadError) throw uploadError;
      const { error: profileError } = await supabase.from('profiles')
        .update({ avatar_path: path })
        .eq('id', userData.id);
      if (profileError) throw profileError;
      setProfilePhotoPath(path);
      setProfilePhotoVersion(Date.now());
      notify('Profile picture updated');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to update your profile picture.'));
    } finally {
      setIsUploadingProfilePhoto(false);
    }
  };

  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2200);
  };

  const contactSupport = async () => {
    try {
      await Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
    } catch (error: unknown) {
      notify(getErrorMessage(error, 'Unable to open your email app.'));
    }
  };

  const openNotification = async (notification: AppNotification) => {
    if (!notification.read_at) {
      const readAt = new Date().toISOString();
      const { error } = await supabase.from('user_notifications')
        .update({ read_at: readAt })
        .eq('id', notification.id);
      if (error) {
        setNotificationError(getErrorMessage(error, 'Unable to mark this notification as read.'));
      } else {
        setNotifications((current) => current.map((item) =>
          item.id === notification.id ? { ...item, read_at: readAt } : item,
        ));
      }
    }

    if (notification.event_type === 'new_chat_message'
      && typeof notification.payload?.store_id === 'string'
      && notification.order_id) {
      await openOrderChat(notification.order_id, notification.payload.store_id);
      return;
    }
    if (typeof notification.payload?.product_id === 'string') {
      const product = remoteProducts.find((item) => item.id === notification.payload.product_id);
      if (product) {
        openProductDetail(product, 'dashboard');
        return;
      }
    }
    if (notification.order_id) {
      const matchingOrder = orders.find((order) => order.dbId === notification.order_id);
      if (matchingOrder) {
        setSelectedOrder(matchingOrder);
        setScreen('tracking');
        return;
      }
    }
    setScreen(role === 'seller' ? 'sellerDashboard' : role === 'delivery' ? 'deliveryDashboard' : 'orders');
  };

  const addToCart = (product: Product, quantity = 1, variant?: ProductVariant, customQuantity = false) => {
    if (!product.id) {
      setDashboardNotice('This product is not available from the marketplace.');
      return false;
    }
    if (product.isAvailable === false) {
      setDashboardNotice(`${product.name} is currently unavailable.`);
      return false;
    }
    const selectedVariant = variant || (!customQuantity && Number(product.quantity || 0) <= 0
      ? product.variants?.find((option) => option.stock > 0)
      : undefined);
    const stock = selectedVariant?.stock ?? Number(product.quantity || 0);
    const key = `${product.id}:${selectedVariant?.id || 'base'}`;
    const alreadyInCart = cart.find((line) => line.key === key)?.quantity || 0;
    if (!Number.isFinite(quantity) || quantity <= 0 || Math.round(quantity * 100) !== quantity * 100) {
      setDashboardNotice('Enter a quantity greater than zero with no more than two decimal places.');
      return false;
    }
    if ((!selectedVariant && stock <= 0) || ((selectedVariant || stock > 0) && alreadyInCart + quantity > stock)) {
      setDashboardNotice('The available stock is already in your cart.');
      return false;
    }
    setPromoDiscount(0);
    setPromoMessage('');
    const line: CartLine = { key, product, quantity, variant: selectedVariant, customQuantity };
    setCart((current) => current.some((item) => item.key === key)
      ? current.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      : [...current, line]);
    setSelectedCartKeys((current) => new Set(current).add(key));
    notify(`${product.name}${selectedVariant ? ` · ${selectedVariant.name}` : ''} added to cart`);
    return true;
  };

  const openProductDetail = (product: Product, returnScreen: Screen) => {
    setProductDetail(product);
    setSelectedProductVariantId(Number(product.quantity || 0) > 0
      ? null
      : product.variants?.find((variant) => variant.stock > 0)?.id || null);
    setCustomProductQuantity('');
    setStorefrontReviews([]);
    setStorefrontReviewsError('');
    setProductDetailReturnScreen(returnScreen);
    setScreen('productDetail');
  };

  const openStorefront = (returnScreen: Screen) => {
    if (!productDetail?.storeId) return;
    setStorefrontReturnScreen(returnScreen);
    setStorefrontReviews([]);
    setStorefrontReviewsError('');
    setScreen('storefront');
  };

  const removeOneFromCart = (lineKey: string) => {
    setPromoDiscount(0);
    setPromoMessage('');
    const existing = cart.find((line) => line.key === lineKey);
    if (existing && existing.quantity <= 1) {
      setSelectedCartKeys((current) => {
        const next = new Set(current);
        next.delete(lineKey);
        return next;
      });
    }
    setCart((current) => {
      const line = current.find((item) => item.key === lineKey);
      if (!line) return current;
      const quantity = Math.max(0, line.quantity - 1);
      return quantity ? current.map((item) => item.key === lineKey ? { ...item, quantity } : item) : current.filter((item) => item.key !== lineKey);
    });
  };

  const removeCartLine = (lineKey: string) => {
    setPromoDiscount(0);
    setPromoMessage('');
    setCart((current) => current.filter((line) => line.key !== lineKey));
    setSelectedCartKeys((current) => {
      const next = new Set(current);
      next.delete(lineKey);
      return next;
    });
  };

  const toggleCartLineSelected = (lineKey: string) => {
    setSelectedCartKeys((current) => {
      const next = new Set(current);
      if (next.has(lineKey)) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });
    setPromoDiscount(0);
    setPromoMessage('');
  };

  const selectedCartLines = cart.filter((line) => selectedCartKeys.has(line.key));

  const toggleSavedProduct = async (product: Product) => {
    const removing = saved.some((item) => item.id === product.id);
    setSaved((current) => removing
      ? current.filter((item) => item.id !== product.id)
      : [...current, product]);
    if (role !== 'buyer' || !currentUserId || !product.id || !isSupabaseConfigured) return;
    try {
      const { error } = removing
        ? await supabase.from('product_favorites').delete().eq('buyer_id', currentUserId).eq('product_id', product.id)
        : await supabase.from('product_favorites').insert({ buyer_id: currentUserId, product_id: product.id });
      if (error) throw error;
    } catch (error: unknown) {
      setSaved((current) => removing
        ? [...current, product]
        : current.filter((item) => item.id !== product.id));
      setDashboardNotice(getErrorMessage(error, 'Unable to save this product to your account.'));
    }
  };

  const toggleProductStockAlert = async (product: Product) => {
    if (!product.id || !currentUserId || role !== 'buyer') {
      setAuthError('Sign in as a buyer to get back-in-stock alerts.');
      return;
    }
    const subscribed = productStockAlertIds.has(product.id);
    try {
      const { error } = subscribed
        ? await supabase.from('product_stock_alerts').delete().eq('buyer_id', currentUserId).eq('product_id', product.id)
        : await supabase.from('product_stock_alerts').insert({ buyer_id: currentUserId, product_id: product.id });
      if (error) throw error;
      setProductStockAlertIds((current) => {
        const next = new Set(current);
        if (subscribed) next.delete(product.id as string);
        else next.add(product.id as string);
        return next;
      });
      notify(subscribed ? 'Back-in-stock alert removed' : 'We’ll alert you when this is available');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update this stock alert.'));
    }
  };

  const applyPromoCode = async () => {
    if (!promoCode.trim()) {
      setPromoMessage('Enter a promo code first.');
      setPromoDiscount(0);
      return;
    }
    if (!currentUserId || !isSupabaseConfigured) {
      setPromoMessage('Sign in and connect to the marketplace to apply a code.');
      return;
    }
    setIsApplyingPromo(true);
    setPromoMessage('');
    try {
      if (!selectedCartLines.length) throw new Error('Select at least one cart item before applying a promo code.');
      const { data, error } = await supabase.rpc('preview_store_promo_for_cart', {
        p_code: promoCode.trim(),
        p_cart_items: selectedCartLines.map((line) => ({
          product_id: line.product.id,
          variant_id: line.variant?.id || null,
          quantity: line.quantity,
        })),
      });
      if (error) throw error;
      const discount = Number(data);
      if (!Number.isFinite(discount) || discount <= 0) throw new Error('This promo code does not apply to your cart.');
      setPromoDiscount(discount);
      setPromoMessage(`Promo applied: ${formatCurrency(discount)} off eligible products.`);
    } catch (error: unknown) {
      setPromoDiscount(0);
      setPromoMessage(getErrorMessage(error, 'Unable to apply this promo code.'));
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const saveSellerPromo = async () => {
    setIsSavingPromo(true);
    setDashboardNotice('');
    try {
      const { error } = sellerPromoActive
        ? await supabase.rpc('deactivate_store_promo')
        : await supabase.rpc('create_store_promo', { p_code: sellerPromoCode });
      if (error) throw error;
      setSellerPromoActive(!sellerPromoActive);
      setSellerPromoCode(sellerPromoActive ? '' : sellerPromoCode.trim().toUpperCase());
      notify(sellerPromoActive ? 'Promo code turned off' : '10% promo code is live');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update your promo code.'));
    } finally {
      setIsSavingPromo(false);
    }
  };

  const openOrderChat = async (orderId: string, storeId: string) => {
    if (!currentUserId || !isSupabaseConfigured) {
      setAuthError('Sign in to message the other person on this order.');
      return;
    }
    setChatError('');
    setIsLoadingChat(true);
    try {
      const { data, error } = await supabase.rpc('get_or_create_order_chat', {
        p_order_id: orderId,
        p_store_id: storeId,
      });
      if (error) throw error;
      if (typeof data !== 'string' || !data) throw new Error('Could not open the order chat.');
      setChatOrderId(orderId);
      setChatReturnScreen(screen);
      setChatThreadId(data);
      setChatMessages([]);
      setScreen('orderChat');
    } catch (error: unknown) {
      setChatError(getErrorMessage(error, 'Unable to open this order chat.'));
      setDashboardNotice(getErrorMessage(error, 'Unable to open this order chat.'));
    } finally {
      setIsLoadingChat(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatThreadId || !chatDraft.trim()) return;
    setIsSendingChat(true);
    setChatError('');
    try {
      const { data, error } = await supabase.rpc('send_order_chat_message', {
        p_thread_id: chatThreadId,
        p_message: chatDraft.trim(),
      });
      if (error) throw error;
      if (typeof data === 'string' && currentUserId) {
        setChatMessages((current) => [...current, {
          id: data,
          thread_id: chatThreadId,
          sender_id: currentUserId,
          message: chatDraft.trim(),
          created_at: new Date().toISOString(),
        }]);
      }
      setChatDraft('');
    } catch (error: unknown) {
      setChatError(getErrorMessage(error, 'Unable to send your message.'));
    } finally {
      setIsSendingChat(false);
    }
  };

  const callAssignedRider = async (order: Order) => {
    if (order.status !== 'out_for_delivery') return;
    setIsCallingRider(true);
    setDashboardNotice('');
    try {
      const { data, error } = await supabase.rpc('get_active_delivery_contact', { p_order_id: order.dbId });
      if (error) throw error;
      const phone = Array.isArray(data) ? data[0]?.phone_number : null;
      if (typeof phone !== 'string' || !phone.trim()) {
        throw new Error('The assigned rider has not enabled phone sharing.');
      }
      const phoneUrl = `tel:${phone.replace(/\D/g, '')}`;
      if (!await Linking.canOpenURL(phoneUrl)) throw new Error('This device cannot open phone links.');
      await Linking.openURL(phoneUrl);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to call the assigned rider.'));
    } finally {
      setIsCallingRider(false);
    }
  };

  const saveRiderCallSettings = async () => {
    setIsSavingRiderPhone(true);
    setAuthError('');
    try {
      const { error } = await supabase.rpc('set_my_rider_call_contact', {
        p_phone_number: riderPhone,
        p_share: riderSharesPhone,
      });
      if (error) throw error;
      notify(riderSharesPhone ? 'Buyers can call you during active deliveries' : 'Rider phone sharing is off');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to save rider call settings.'));
    } finally {
      setIsSavingRiderPhone(false);
    }
  };

  const markMarketplaceAlertRead = async (alert: MarketplaceAlert) => {
    if (alert.read_at) return;
    const readAt = new Date().toISOString();
    const { error } = await supabase.from('marketplace_alerts')
      .update({ read_at: readAt })
      .eq('id', alert.id);
    if (error) {
      setNotificationError(getErrorMessage(error, 'Unable to mark this alert as read.'));
      return;
    }
    setMarketplaceAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, read_at: readAt } : item));
  };

  const reorderOrder = async (order: Order) => {
    setAuthError('');
    try {
      const productIds = order.items.map((item) => item.id).filter((id): id is string => Boolean(id));
      if (!productIds.length || productIds.length !== order.items.length) {
        throw new Error('Some products from this order are no longer available to reorder.');
      }
      const { data, error } = await supabase.from('products')
        .select('id, store_id, name, price, unit, category, image_url, description, stock_quantity, is_available, variant_options, stores(name, category)')
        .in('id', productIds);
      if (error) throw error;
      const currentProducts = (data || []) as ProductWithStoreRow[];
      const productsById = new Map(currentProducts.map((product) => [product.id, product]));
      const unavailable: string[] = [];
      const productsToAdd: CartLine[] = [];
      const alreadyInCart = new Map<string, number>();
      cart.forEach((line) => {
        if (line.product.id) {
          const key = `${line.product.id}:${line.variant?.id || 'base'}`;
          alreadyInCart.set(key, (alreadyInCart.get(key) || 0) + line.quantity);
        }
      });
      for (const item of order.items) {
        const product = item.id ? productsById.get(item.id) : undefined;
        const quantity = Number(item.quantity || 1);
        const selectedVariant = product?.variant_options?.find((variant) => variant.id === item.orderVariantId);
        const key = `${item.id || ''}:${selectedVariant?.id || 'base'}`;
        const inCart = alreadyInCart.get(key) || 0;
        const availableStock = selectedVariant?.stock ?? Number(product?.stock_quantity || 0);
        if (!product || !product.is_available || (item.orderVariantId && !selectedVariant) || availableStock < quantity + inCart) {
          unavailable.push(item.name);
          continue;
        }
        productsToAdd.push({
          key: `${product.id}:${selectedVariant?.id || 'base'}:reorder:${Date.now()}:${productsToAdd.length}`,
          quantity,
          variant: selectedVariant,
          customQuantity: item.orderCustomQuantity ?? true,
          product: {
            id: product.id,
            storeId: product.store_id,
            name: product.name,
            store: Array.isArray(product.stores) ? product.stores[0]?.name || 'Local seller' : product.stores?.name || 'Local seller',
            storeCategory: Array.isArray(product.stores) ? product.stores[0]?.category : product.stores?.category,
            price: `${formatCurrency(Number(product.price))} / ${product.unit}`,
            category: product.category,
            imageUrl: product.image_url || undefined,
            description: product.description || undefined,
            quantity: String(product.stock_quantity),
            unit: product.unit,
            isAvailable: product.is_available,
            variants: product.variant_options || [],
          },
        });
        alreadyInCart.set(key, inCart + quantity);
      }
      if (unavailable.length) {
        throw new Error(`Not enough stock to reorder: ${unavailable.join(', ')}. Your cart was not changed.`);
      }
      setPromoDiscount(0);
      setPromoMessage('');
      setCart((current) => [...current, ...productsToAdd]);
      setSelectedCartKeys((current) => new Set([...current, ...productsToAdd.map((line) => line.key)]));
      setToast(`${productsToAdd.length} product${productsToAdd.length === 1 ? '' : 's'} added to your cart.`);
      setScreen('cart');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to reorder these products.'));
    }
  };

  const offerSubstitution = async (order: SellerOrder, item: SellerOrderItem, product: Product) => {
    if (!product.id) return;
    const busyId = `${item.id}:${product.id}`;
    setSubmittingSubstitutionId(busyId);
    setDashboardNotice('');
    try {
      const { error } = await supabase.rpc('offer_order_item_substitution', {
        p_order_item_id: item.id,
        p_substitute_product_id: product.id,
      });
      if (error) throw error;
      setSellerOrders((current) => current.map((entry) => entry.dbId === order.dbId ? {
        ...entry,
        orderItems: entry.orderItems.map((row) => row.id === item.id ? { ...row, substitutionStatus: 'pending' } : row),
      } : entry));
      setDashboardNotice(`Substitution suggested for ${item.name}. The buyer must approve it before you continue.`);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to offer this substitution.'));
    } finally {
      setSubmittingSubstitutionId('');
    }
  };

  const respondToSubstitution = async (order: Order, item: Product, accept: boolean) => {
    if (!item.orderItemId || !item.substitutionOffer) return;
    setAuthError('');
    try {
      const { error } = await supabase.rpc('respond_to_order_item_substitution', {
        p_order_item_id: item.orderItemId,
        p_accept: accept,
      });
      if (error) throw error;
      const updatedItems = order.items.map((current) => current.orderItemId !== item.orderItemId
        ? current
        : accept
          ? {
            ...item.substitutionOffer!.product,
            orderItemId: item.orderItemId,
            quantity: item.quantity,
            substitutionOffer: item.substitutionOffer,
          }
          : { ...current, substitutionOffer: { ...current.substitutionOffer!, status: 'declined' } });
      const updatedOrder = { ...order, items: updatedItems };
      setSelectedOrder(updatedOrder);
      setOrders((current) => current.map((entry) => entry.id === order.id ? updatedOrder : entry));
      setToast(accept ? 'Substitution approved.' : 'Substitution declined. The seller has been notified.');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to save your substitution decision.'));
    }
  };

  const submitStoreReview = async (order: Order, storeId: string) => {
    const key = `${order.id}:${storeId}`;
    const draft = reviewDrafts[key] || { rating: 5, review: '' };
    setSubmittingReviewKey(key);
    setAuthError('');
    try {
      const { error } = await supabase.rpc('submit_store_review', {
        p_order_id: order.id,
        p_store_id: storeId,
        p_rating: draft.rating,
        p_review: draft.review.trim(),
      });
      if (error) throw error;
      const reviews = [...order.reviews.filter((review) => review.storeId !== storeId), {
        storeId,
        rating: draft.rating,
        review: draft.review.trim(),
      }];
      const updatedOrder = { ...order, reviews };
      setSelectedOrder(updatedOrder);
      setOrders((current) => current.map((entry) => entry.id === order.id ? updatedOrder : entry));
      setToast('Thanks for reviewing this store.');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to submit your review.'));
    } finally {
      setSubmittingReviewKey('');
    }
  };

  const submitOrderIssue = async (order: Order) => {
    setIsSubmittingIssue(true);
    setAuthError('');
    try {
      const { data, error } = await supabase.rpc('submit_order_issue', {
        p_order_id: order.id,
        p_issue_type: issueType,
        p_description: issueDescription.trim(),
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('The issue report could not be confirmed.');
      const issue: OrderIssue = {
        id: data,
        issueType,
        description: issueDescription.trim(),
        status: 'open',
        adminNote: '',
        createdAt: new Date().toISOString(),
      };
      const updatedOrder = { ...order, issues: [issue, ...order.issues] };
      setSelectedOrder(updatedOrder);
      setOrders((current) => current.map((entry) => entry.id === order.id ? updatedOrder : entry));
      setIssueDescription('');
      setToast('Issue report sent to GetBuy support.');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to submit your order issue.'));
    } finally {
      setIsSubmittingIssue(false);
    }
  };

  const updateAdminIssue = async (issue: AdminIssue, status: string) => {
    try {
      const adminNote = adminIssueNotes[issue.id] ?? issue.admin_note;
      const { error } = await supabase.rpc('update_order_issue', {
        p_issue_id: issue.id,
        p_status: status,
        p_admin_note: adminNote,
      });
      if (error) throw error;
      setAdminIssues((current) => current.map((entry) => entry.id === issue.id
        ? { ...entry, status, admin_note: adminNote }
        : entry));
      setDashboardNotice('Issue report updated.');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update this issue report.'));
    }
  };

  const createAccount = async () => {
    setAuthError('');
    setSignupNotice('');
    if (!isSupabaseConfigured) {
      setAuthError('Account creation requires Supabase configuration.');
      return;
    }
    if (role === 'admin') {
      setAuthError('Administrator accounts are invitation-only.');
      return;
    }
    if (password.length < 8) {
      setAuthError('Choose a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    if ((role === 'buyer' || role === 'seller' || role === 'delivery') && signupPhone.replace(/\D/g, '').length < 10) {
      setAuthError('Enter a valid phone number with at least 10 digits.');
      return;
    }
    setIsSubmittingAuth(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            role,
            ...(role === 'buyer' || role === 'seller' || role === 'delivery' ? { phone_number: signupPhone.trim() } : {}),
          },
        },
      });
      if (error) throw error;
      setPassword('');
      setConfirmPassword('');
      if (!data.session) {
        setSignupCode('');
        setSignupNotice(`We’ve sent a verification code to ${email.trim()}.`);
        setScreen('verifySignup');
        return;
      }
      await saveRememberedLogin(email);
      await rememberRegisteredAccount();
      setCurrentUserId(data.session.user.id);
      setIsGuestBrowsing(false);
      if (checkoutAfterAuth.current && role === 'buyer') {
        checkoutAfterAuth.current = false;
        setScreen('checkout');
      } else {
        setScreen(role === 'seller' ? 'sellerSetup' : role === 'delivery' ? 'deliverySetup' : 'location');
      }
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Unable to create your account.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const verifySignupCode = async () => {
    const token = signupCode.trim();
    if (!isValidEmailOtp(token)) {
      setAuthError('Enter the verification code from your email.');
      return;
    }
    if (!isSupabaseConfigured) {
      setAuthError('Email verification requires Supabase configuration.');
      return;
    }
    setIsSubmittingAuth(true);
    setAuthError('');
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'signup',
      });
      if (error) throw error;
      if (!data.session?.user) throw new Error('Email verified, but your account session could not be started. Please sign in.');
      await saveRememberedLogin(email);
      await rememberRegisteredAccount();
      setCurrentUserId(data.session.user.id);
      setIsGuestBrowsing(false);
      setSignupCode('');
      setSignupNotice('');
      if (checkoutAfterAuth.current && role === 'buyer') {
        checkoutAfterAuth.current = false;
        setScreen('checkout');
      } else {
        setScreen(role === 'seller' ? 'sellerSetup' : role === 'delivery' ? 'deliverySetup' : 'location');
      }
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'That verification code is invalid or expired.'));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const resendSignupCode = async () => {
    if (!isSupabaseConfigured) {
      setAuthError('Email verification requires Supabase configuration.');
      return;
    }
    setIsSubmittingAuth(true);
    setAuthError('');
    setSignupNotice('');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (error) throw error;
      setSignupNotice(`A new verification code was sent to ${email.trim()}.`);
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to resend the verification code.'));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const signIn = async () => {
    setAuthError('');
    if (!isSupabaseConfigured) {
      setAuthError('Sign in requires Supabase configuration.');
      return;
    }
    setIsSubmittingAuth(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
      if (profileError) throw profileError;
      await saveRememberedLogin(email);
      await rememberRegisteredAccount();
      const signedInRole = profile.role as Role;
      if (signedInRole === 'admin') {
        await supabase.auth.signOut();
        setRole('admin');
        setScreen('adminSetup');
        return;
      }
      setCurrentUserId(data.user.id);
      setRole(signedInRole);
      setName(profile.full_name || '');
      setSignupPhone(profile.phone_number || '');
      setProfilePhotoPath(profile.avatar_path || null);
      setLocation(profile.location || '');
      setArea(profile.area || '');
      setDirections(profile.directions || '');
      if (signedInRole === 'delivery') setServiceArea(profile.area || profile.location || '');
      setIsGuestBrowsing(false);
      if (checkoutAfterAuth.current && signedInRole === 'buyer') {
        checkoutAfterAuth.current = false;
        setScreen('checkout');
      } else {
        checkoutAfterAuth.current = false;
        setScreen(signedInRole === 'seller' ? 'sellerDashboard' : signedInRole === 'delivery' ? 'deliveryDashboard' : 'dashboard');
      }
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const signInWithProvider = async (provider: 'google' | 'facebook' | 'apple') => {
    setAuthError('');
    if (!isSupabaseConfigured) {
      setAuthError('Social sign-in requires Supabase configuration.');
      return;
    }
    if (role === 'admin') {
      setAuthError('Administrator accounts must use their invited email and password.');
      return;
    }
    if (screen === 'create' && (role === 'buyer' || role === 'seller' || role === 'delivery') && signupPhone.replace(/\D/g, '').length < 10) {
      setAuthError('Enter a valid phone number before continuing with social sign-up.');
      return;
    }
    setIsSubmittingAuth(true);
    pendingOAuthRole.current = {
      role: role || 'buyer',
      isSignup: screen === 'create',
      phoneNumber: signupPhone.trim(),
    };
    try {
      const redirectTo = Platform.OS === 'web'
        ? `${window.location.origin}/auth/callback`
        : 'getbuy://auth/callback';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error(`Supabase did not return a ${provider} sign-in URL.`);
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        await handleAuthCallback(result.url);
      } else {
        pendingOAuthRole.current = null;
        if (result.type !== 'cancel' && result.type !== 'dismiss') {
          throw new Error('Social sign-in did not complete. Please try again.');
        }
      }
    } catch (error: unknown) {
      pendingOAuthRole.current = null;
      setAuthError(getErrorMessage(error, `Unable to continue with ${provider}. Check that this provider is enabled in Supabase.`));
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const toggleBiometricSignIn = async () => {
    setAuthError('');
    setIsBiometricBusy(true);
    try {
      if (biometricEnabled) {
        setBiometricEnabled(false);
        notify('Biometric unlock disabled');
        return;
      }
      const enrolledLevel = await LocalAuthentication.getEnrolledLevelAsync();
      if (enrolledLevel === LocalAuthentication.SecurityLevel.NONE) {
        throw new Error('Set up Face ID, a fingerprint, or a screen lock in your device settings first.');
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm your device unlock for GetBuy',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (!result.success) return;
      setBiometricEnabled(true);
      notify('Quick unlock enabled on this device');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to enable biometric unlock.'));
    } finally {
      setIsBiometricBusy(false);
    }
  };

  const unlockWithBiometrics = async () => {
    setAuthError('');
    setIsBiometricBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock your saved GetBuy session',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (!result.success) return;
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session?.user) throw new Error('Your saved sign-in has expired. Sign in with your password once to restore quick unlock.');
      const user = sessionData.session.user;
      setCurrentUserId(user.id);
      const { data: profile, error: profileError } = await supabase.from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      const signedInRole = profile.role as Role;
      if (signedInRole === 'admin') {
        await supabase.auth.signOut();
        setRole('admin');
        setScreen('adminSetup');
        return;
      }
      setEmail(user.email || '');
      setName(profile.full_name || '');
      setSignupPhone(profile.phone_number || '');
      setProfilePhotoPath(profile.avatar_path || null);
      setLocation(profile.location || '');
      setArea(profile.area || '');
      setDirections(profile.directions || '');
      if (signedInRole === 'delivery') setServiceArea(profile.area || profile.location || '');
      setRole(signedInRole);
      setScreen(signedInRole === 'seller' ? 'sellerDashboard' : signedInRole === 'delivery' ? 'deliveryDashboard' : 'dashboard');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to unlock your account.'));
    } finally {
      setIsBiometricBusy(false);
    }
  };

  const saveProductListing = async (input: {
    name: string;
    price: string;
    quantity: string;
    unit: string;
    category: string;
    imageUri: string | null;
    imageBase64: string | null;
    imageMimeType: string;
    description: string;
    available: boolean;
    variants?: ProductVariantDraft[];
  }, productId: string | null = null) => {
    if (!isSupabaseConfigured) throw new Error('Product listings require Supabase configuration.');
    const stockQuantity = Number(input.quantity);
    const price = Number(input.price);
    if (!input.name.trim() || !input.price.trim() || !input.quantity.trim() || !input.category) {
      throw new Error('Add a product name, category, price, and stock quantity first.');
    }
    if (!Number.isFinite(price) || price < 0 || Math.round(price * 100) !== price * 100) {
      throw new Error('Enter a valid naira price with no more than two decimal places.');
    }
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0 || Math.round(stockQuantity * 100) !== stockQuantity * 100) {
      throw new Error('Enter a valid stock quantity with no more than two decimal places.');
    }
    const variantNames = new Set<string>();
    const variants = (input.variants || []).map((variant) => {
      const variantName = variant.name.trim();
      const variantPrice = Number(variant.price);
      const variantStock = Number(variant.stock);
      if (!variantName || !variant.price.trim() || !variant.stock.trim()
        || !Number.isFinite(variantPrice) || variantPrice < 0
        || Math.round(variantPrice * 100) !== variantPrice * 100
        || !Number.isFinite(variantStock) || variantStock < 0
        || Math.round(variantStock * 100) !== variantStock * 100) {
        throw new Error('Each size option needs a name, valid price, and stock amount.');
      }
      if (variantNames.has(variantName.toLowerCase())) throw new Error('Size option names must be unique.');
      variantNames.add(variantName.toLowerCase());
      return { id: variant.id, name: variantName, unit: variant.unit.trim() || input.unit, price: variantPrice, stock: variantStock };
    });

    const userData = await getCurrentAuthenticatedUser();
    if (!userData) throw new Error('Please sign in before adding products.');

    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id')
      .eq('owner_id', userData.id)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error('Create your store before adding products.');

    let imageUrl = input.imageUri;
    if (input.imageUri && !input.imageUri.startsWith('http')) {
      if (!input.imageBase64) throw new Error('Could not read the selected image. Please choose it again.');
      const binaryImage = atob(input.imageBase64);
      const imageBytes = new Uint8Array(binaryImage.length);
      for (let index = 0; index < binaryImage.length; index += 1) imageBytes[index] = binaryImage.charCodeAt(index);
      const fileName = `${userData.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, imageBytes.buffer, {
        contentType: input.imageMimeType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      imageUrl = supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
    }

    const productPayload = {
      store_id: store.id,
      name: input.name.trim(),
      price,
      unit: input.unit,
      category: input.category,
      image_url: imageUrl,
      description: input.description.trim() || null,
      stock_quantity: stockQuantity,
      variant_options: variants,
      is_available: (stockQuantity > 0 || variants.some((variant) => variant.stock > 0)) && input.available,
    };
    const productRequest = productId
      ? supabase.from('products').update(productPayload).eq('id', productId)
      : supabase.from('products').insert(productPayload);
    const { data: savedProduct, error: productError } = await productRequest.select('id').single();
    if (productError) throw productError;

    return {
      id: savedProduct.id,
      name: input.name.trim(),
      store: storeName || 'Your store',
      price: `${formatCurrency(price)} / ${input.unit}`,
      category: input.category,
      imageUrl: imageUrl || undefined,
      quantity: input.quantity,
      unit: input.unit,
      variants,
      description: input.description.trim() || undefined,
      isAvailable: (stockQuantity > 0 || variants.some((variant) => variant.stock > 0)) && input.available,
    } satisfies Product;
  };

  const addProduct = async () => {
    setAuthError('');
    setIsSavingProduct(true);
    try {
      const product = await saveProductListing({
        name: newProductName,
        price: newProductPrice,
        quantity: newProductQuantity,
        unit: newProductUnit,
        category: newProductCategory,
        imageUri: newProductImage,
        imageBase64: newProductImageBase64,
        imageMimeType: newProductImageMimeType,
        description: newProductDescription,
        available: newProductAvailable,
        variants: newProductVariants,
      }, editingProductId);
      setInventory((current) => editingProductId
        ? current.map((item) => item.id === editingProductId ? product : item)
        : [...current, product]);
      setNewProductName('');
      setNewProductPrice('');
      setNewProductImage(null);
      setNewProductImageBase64(null);
      setNewProductImageMimeType('image/jpeg');
      setNewProductQuantity('');
      setNewProductVariants([]);
      setNewProductUnit('kg');
      setNewProductCategory('Produce');
      setNewProductDescription('');
      setNewProductAvailable(true);
      setEditingProductId(null);
      setScreen('sellerDashboard');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to add product.'));
    } finally {
      setIsSavingProduct(false);
    }
  };

  const prepareBulkProductDrafts = (assets: ImagePicker.ImagePickerAsset[]) => {
    const remainingSlots = 10 - bulkProductDrafts.length;
    if (remainingSlots <= 0) {
      setBulkProductError('You can add up to 10 products per batch. Publish or remove a product to continue.');
      return;
    }
    const accepted: BulkProductDraft[] = [];
    const rejected: string[] = [];
    assets.slice(0, remainingSlots).forEach((asset, index) => {
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        rejected.push(asset.fileName || `Photo ${index + 1} (unsupported format)`);
        return;
      }
      if (!asset.base64 || Math.ceil(asset.base64.length * 3 / 4) > 5 * 1024 * 1024) {
        rejected.push(asset.fileName || `Photo ${index + 1} (over 5 MB or unreadable)`);
        return;
      }
      accepted.push({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        imageUri: asset.uri,
        imageBase64: asset.base64,
        imageMimeType: mimeType,
        name: '',
        category: '',
        price: '',
        quantity: '',
        unit: 'kg',
      });
    });
    if (accepted.length) setBulkProductDrafts((current) => [...current, ...accepted]);
    setBulkProductError(rejected.length
      ? `Skipped ${rejected.join(', ')}. Choose JPG, PNG, or WebP photos smaller than 5 MB.`
      : assets.length > remainingSlots ? 'Only the first 10 products in this batch were added.' : '');
  };

  const chooseBulkProductImages = async () => {
    setBulkProductError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access to choose product photos.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        allowsEditing: false,
        base64: true,
        quality: 0.65,
      });
      if (!result.canceled) prepareBulkProductDrafts(result.assets);
    } catch (error: unknown) {
      setBulkProductError(getErrorMessage(error, 'Unable to open the photo library.'));
    }
  };

  const takeBulkProductPhoto = async () => {
    setBulkProductError('');
    try {
      if (bulkProductDrafts.length >= 10) throw new Error('You can add up to 10 products per batch.');
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Allow camera access to take product photos.');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.65,
      });
      if (!result.canceled) prepareBulkProductDrafts(result.assets);
    } catch (error: unknown) {
      setBulkProductError(getErrorMessage(error, 'Unable to take a product photo.'));
    }
  };

  const publishBulkProducts = async () => {
    setBulkProductError('');
    if (!bulkProductDrafts.length) {
      setBulkProductError('Add at least one product photo first.');
      return;
    }
    setIsSavingBulkProducts(true);
    const failedDrafts: BulkProductDraft[] = [];
    const savedProducts: Product[] = [];
    const errors: string[] = [];
    for (const [index, draft] of bulkProductDrafts.entries()) {
      try {
        savedProducts.push(await saveProductListing({
          name: draft.name,
          price: draft.price,
          quantity: draft.quantity,
          unit: draft.unit,
          category: draft.category,
          imageUri: draft.imageUri,
          imageBase64: draft.imageBase64,
          imageMimeType: draft.imageMimeType,
          description: '',
          available: true,
        }));
      } catch (error: unknown) {
        failedDrafts.push(draft);
        errors.push(`${draft.name.trim() || `Photo ${index + 1}`}: ${getErrorMessage(error, 'Could not publish.')}`);
      }
    }
    if (savedProducts.length) {
      setInventory((current) => [...current, ...savedProducts]);
      setBulkProductDrafts(failedDrafts);
    }
    if (errors.length) {
      setBulkProductError(`${savedProducts.length} published; ${errors.length} need attention. ${errors.join(' ')}`);
      setIsSavingBulkProducts(false);
      return;
    }
    setBulkProductDrafts([]);
    setScreen('sellerDashboard');
    notify(`${savedProducts.length} product${savedProducts.length === 1 ? '' : 's'} published`);
    setIsSavingBulkProducts(false);
  };

  const editProduct = (product: Product) => {
    setEditingProductId(product.id || null);
    setNewProductName(product.name);
    setNewProductPrice(String(parsePriceAmount(product.price)));
    setNewProductImage(product.imageUrl || null);
    setNewProductImageBase64(null);
    setNewProductImageMimeType('image/jpeg');
    setNewProductQuantity(product.quantity || '');
    setNewProductVariants((product.variants || []).map((variant) => ({
      id: variant.id,
      name: variant.name,
      unit: variant.unit,
      price: String(variant.price),
      stock: String(variant.stock),
    })));
    setNewProductUnit(product.unit || 'kg');
    setNewProductCategory(product.category || 'Produce');
    setNewProductDescription(product.description || '');
    setNewProductAvailable(product.isAvailable ?? false);
    setScreen('addProduct');
  };

  const deleteProduct = async (product: Product) => {
    try {
      if (!isSupabaseConfigured || !product.id) throw new Error('This listing is not connected to the marketplace.');
      const { error } = await supabase.from('products').delete().eq('id', product.id);
      if (error) throw error;
      setInventory((current) => current.filter((item) => item.id !== product.id));
      notify(`${product.name} removed from inventory`);
    } catch (error: unknown) {
      setDashboardNotice(error instanceof Error ? error.message : 'Unable to remove product.');
    }
  };

  const setProductAvailability = async (product: Product, isAvailable: boolean) => {
    try {
      if (!isSupabaseConfigured || !product.id) throw new Error('This listing is not connected to the marketplace.');
      if (isAvailable && Number(product.quantity || 0) <= 0 && !(product.variants || []).some((variant) => variant.stock > 0)) {
        throw new Error('Add stock before making this product available.');
      }
      const { error } = await supabase.from('products').update({ is_available: isAvailable }).eq('id', product.id);
      if (error) throw error;
      setInventory((current) => current.map((item) => item.id === product.id ? { ...item, isAvailable } : item));
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update product availability.'));
    }
  };

  const saveBulkStock = async () => {
    const updates = inventory.filter((product) => product.id && stockDrafts[product.id] !== undefined);
    if (updates.length === 0) {
      setDashboardNotice('Enter stock counts for at least one product.');
      return;
    }
    if (updates.some((product) => !/^\d+$/.test(stockDrafts[product.id!]))) {
      setDashboardNotice('Stock counts must be whole numbers of zero or more.');
      return;
    }
    setIsSavingBulkStock(true);
    setDashboardNotice('');
    try {
      const { error } = await supabase.rpc('bulk_update_store_stock', {
        p_product_ids: updates.map((product) => product.id!),
        p_quantities: updates.map((product) => Number(stockDrafts[product.id!])),
      });
      if (error) throw error;
      const counts = new Map(updates.map((product) => [product.id, Number(stockDrafts[product.id!])]));
      setInventory((current) => current.map((product) => product.id && counts.has(product.id)
        ? { ...product, quantity: String(counts.get(product.id)), isAvailable: (counts.get(product.id) || 0) > 0 }
        : product));
      setStockDrafts({});
      setDashboardNotice(`Updated stock for ${updates.length} ${updates.length === 1 ? 'product' : 'products'}.`);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update stock.'));
    } finally {
      setIsSavingBulkStock(false);
    }
  };

  const advanceSellerOrder = async (order: { dbId: string; status: string }) => {
    const nextStatus: Record<string, string> = {
      pending: 'accepted',
      accepted: 'preparing',
      preparing: 'ready',
    };
    const status = nextStatus[order.status];
    if (!status) return;
    try {
      const { data: updatedOrder, error } = await supabase.from('orders')
        .update({ status })
        .eq('id', order.dbId)
        .eq('status', order.status)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!updatedOrder) throw new Error('This order changed before your update. Refresh the dashboard and try again.');
      setSellerOrders((current) => current.map((item) => item.dbId === order.dbId ? { ...item, status } : item));
      if (status === 'ready') {
        try {
          const { error: notificationError } = await supabase.functions.invoke('notify-order-event', {
            body: { event_type: 'order_ready', order_id: order.dbId },
          });
          if (notificationError) throw notificationError;
          setDashboardNotice('Order marked ready. Available riders have been notified.');
        } catch (notificationError: unknown) {
          console.error('Order is ready, but rider push notification dispatch failed.', notificationError);
          setDashboardNotice('Order marked ready. Riders can see it in the app, but push notification delivery failed.');
        }
      }
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update this order.'));
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setRecoveryError('Enter your email address first.');
      return;
    }
    if (!isSupabaseConfigured) {
      setRecoveryError('Password reset requires Supabase configuration.');
      return;
    }
    setRecoveryError('');
    setRecoveryNotice('');
    setIsSubmittingRecovery(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setRecoveryCode('');
      setRecoveryNotice(`We’ve sent a verification code to ${email.trim()}.`);
      setScreen('verifyRecovery');
    } catch (error: unknown) {
      setRecoveryError(getErrorMessage(error, 'Unable to send a password reset email.'));
    } finally {
      setIsSubmittingRecovery(false);
    }
  };

  const verifyRecoveryCode = async () => {
    const token = recoveryCode.trim();
    if (!isValidEmailOtp(token)) {
      setRecoveryError('Enter the verification code from your email.');
      return;
    }
    setIsSubmittingRecovery(true);
    setRecoveryError('');
    setRecoveryNotice('');
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'recovery',
      });
      if (error) throw error;
      setRecoveryCode('');
      setScreen('newPassword');
    } catch (error: unknown) {
      setRecoveryError(getErrorMessage(error, 'That verification code is invalid or expired.'));
    } finally {
      setIsSubmittingRecovery(false);
    }
  };

  const updateRecoveredPassword = async () => {
    setRecoveryError('');
    setRecoveryNotice('');
    if (newPassword.length < 8) {
      setRecoveryError('Choose a password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setRecoveryError('Passwords do not match.');
      return;
    }
    setIsSubmittingRecovery(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setRecoveryNotice('Password updated successfully.');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error: unknown) {
      setRecoveryError(getErrorMessage(error, 'Unable to update your password.'));
    } finally {
      setIsSubmittingRecovery(false);
    }
  };

  const finishPasswordRecovery = async () => {
    setIsSubmittingRecovery(true);
    setRecoveryError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setCurrentUserId(null);
      setPassword('');
      setScreen('signin');
      setAuthError('');
      setRecoveryNotice('');
    } catch (error: unknown) {
      setRecoveryError(getErrorMessage(error, 'Password changed, but we could not return you to sign in.'));
    } finally {
      setIsSubmittingRecovery(false);
    }
  };

  const confirmOrder = async () => {
    setAuthError('');
    if (!location.trim()) {
      setAuthError('Enter your delivery address before placing the order.');
      return;
    }
    const checkoutLines = selectedCartLines;
    const cartItems = checkoutLines.map((line) => ({
      product_id: line.product.id,
      variant_id: line.variant?.id || null,
      quantity: line.quantity,
    }));
    if (cartItems.length === 0 || cartItems.some((item) => !item.product_id)) {
      setAuthError('Select at least one valid cart item before placing the order.');
      return;
    }
    if (cartItems.length > 100) {
      setAuthError('This cart has too many different items. Remove some items before checkout.');
      return;
    }
    if (cart.length === 0) {
      setAuthError('Your cart contains no orderable items. Review your cart and try again.');
      return;
    }
    if (!isSupabaseConfigured) {
      setAuthError('Placing an order requires the marketplace connection. Please try again later.');
      return;
    }
    let monnifyPopup: Window | null = null;
    if (!usePaymentSimulator && paymentMethod !== 'cash_on_delivery' && Platform.OS === 'web') {
      monnifyPopup = window.open('about:blank', '_blank');
      if (!monnifyPopup) {
        setAuthError('Allow pop-ups for GetBuy to open the Monnify checkout page, then try again.');
        return;
      }
    }

    setIsSubmittingOrder(true);
    let createdOrderId = '';
    const removeCheckedOutLines = () => {
      const checkedOutKeys = new Set(checkoutLines.map((line) => line.key));
      setCart((current) => current.filter((line) => !checkedOutKeys.has(line.key)));
      setSelectedCartKeys((current) => new Set([...current].filter((key) => !checkedOutKeys.has(key))));
      setPromoCode('');
      setPromoDiscount(0);
      setPromoMessage('');
    };
    try {
      if (usePaymentSimulator) {
        const { data, error } = await supabase.functions.invoke('payment-simulator', {
          body: {
            action: 'checkout',
            delivery_address: location.trim(),
            cart_items: cartItems,
            delivery_slot: deliverySlot,
            promo_code: promoDiscount > 0 ? promoCode.trim() : null,
            delivery_date: deliveryDate,
            loyalty_points: 0,
          },
        });
        if (error) throw error;
        if (typeof data?.order_id !== 'string') throw new Error('The payment simulator did not return a test order.');
        createdOrderId = data.order_id;
        removeCheckedOutLines();
        setSelectedOrder(null);
        setToast('Test order created. Open it and choose a simulated payment result. No real payment will be made.');
        setScreen('orders');
        return;
      }

      if (paymentMethod !== 'cash_on_delivery') {
        const monnifyReturnUrl = Platform.OS === 'web'
          ? 'browser'
          : ExpoLinking.createURL('monnify-return');
        const { data, error } = await supabase.functions.invoke('monnify-payment', {
          body: {
            action: 'checkout',
            return_url: monnifyReturnUrl,
            delivery_address: location.trim(),
            cart_items: cartItems,
            payment_method: paymentMethod,
            delivery_slot: deliverySlot,
            promo_code: promoDiscount > 0 ? promoCode.trim() : null,
            delivery_date: deliveryDate,
            loyalty_points: 0,
          },
        });
        if (error) throw error;
        if (typeof data?.order_id !== 'string' || typeof data?.checkout_url !== 'string') {
          throw new Error('Monnify did not return a valid checkout session.');
        }
        createdOrderId = data.order_id;
        removeCheckedOutLines();
        setSelectedOrder(null);

        if (monnifyPopup) {
          monnifyPopup.location.href = data.checkout_url;
          monnifyPopup.focus();
          setToast('Monnify checkout opened in a new tab. Return to your order and check payment after completing it.');
          setScreen('orders');
          return;
        }

        await WebBrowser.openAuthSessionAsync(data.checkout_url, monnifyReturnUrl);
        const { data: verification, error: verifyError } = await supabase.functions.invoke('monnify-payment', {
          body: { action: 'verify', order_id: createdOrderId },
        });
        if (verifyError) throw verifyError;
        if (verification?.paid !== true) {
          setToast('Payment is still pending. You can check its status from your order details.');
          setScreen('orders');
          return;
        }
        if (verification.cancelled === true) {
          setToast('Payment completed after this order was cancelled. A manual refund has been opened; please do not pay again.');
          setScreen('orders');
          return;
        }

        let pushDispatchFailed = false;
        try {
          const { error: notificationError } = await supabase.functions.invoke('notify-order-event', {
            body: { event_type: 'new_order', order_id: createdOrderId },
          });
          if (notificationError) throw notificationError;
        } catch (notificationError: unknown) {
          pushDispatchFailed = true;
          console.error('Payment was confirmed, but seller push notification dispatch failed.', notificationError);
        }
        setAuthError('');
        setToast(pushDispatchFailed
          ? 'Payment confirmed. Seller alerts are available in-app; push delivery is pending setup.'
          : 'Payment confirmed. Seller has been notified.');
        setScreen('orders');
        return;
      }

      const { data: orderId, error } = await supabase.rpc('create_marketplace_order_with_cart_options', {
        p_delivery_address: location.trim(),
        p_payment_method: 'cash_on_delivery',
        p_cart_items: cartItems,
        p_delivery_slot: deliverySlot,
        p_promo_code: promoDiscount > 0 ? promoCode.trim() : null,
        p_delivery_date: deliveryDate,
        p_loyalty_points: 0,
      });
      if (error) throw error;
      if (typeof orderId !== 'string' || !orderId) {
        throw new Error('The order was not confirmed. Please refresh your orders before trying again.');
      }
      let pushDispatchFailed = false;
      try {
        const { error: notificationError } = await supabase.functions.invoke('notify-order-event', {
          body: { event_type: 'new_order', order_id: orderId },
        });
        if (notificationError) throw notificationError;
      } catch (notificationError: unknown) {
        pushDispatchFailed = true;
        console.error('Order was placed, but seller push notification dispatch failed.', notificationError);
      }
      removeCheckedOutLines();
      setSelectedOrder(null);
      setAuthError('');
      setToast(pushDispatchFailed
        ? 'Order placed. Seller alerts are available in-app; push delivery is pending setup.'
        : 'Order placed. Seller has been notified. Pay cash on delivery.');
      setScreen('orders');
    } catch (error: unknown) {
      if (monnifyPopup && !createdOrderId) monnifyPopup.close();
      if (createdOrderId) {
        setToast('Your order was created, but payment status could not be confirmed yet. Check your order details before trying again.');
        setScreen('orders');
      } else {
        setAuthError(getErrorMessage(error, 'Unable to place your order. Please try again.'));
      }
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const confirmOrderReceived = async (order: Order) => {
    setIsConfirmingReceived(true);
    setAuthError('');
    try {
      const { error } = await supabase.rpc('confirm_order_received', { p_order_id: order.id });
      if (error) throw error;
      const confirmedAt = new Date().toISOString();
      const updatedOrder = { ...order, buyerConfirmedAt: confirmedAt };
      setSelectedOrder(updatedOrder);
      setOrders((current) => current.map((item) => item.id === order.id ? updatedOrder : item));
      notify('Receipt confirmed. Seller and rider payouts are now eligible.');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to confirm order receipt.'));
    } finally {
      setIsConfirmingReceived(false);
    }
  };

  const requestOrderCancellation = async (order: Order) => {
    const reason = cancellationReasons[order.id]?.trim() || '';
    if (reason.length < 5) {
      setDashboardNotice('Add a cancellation reason with at least 5 characters.');
      return;
    }
    setDashboardNotice('');
    try {
      const { data: requestId, error } = await supabase.rpc('request_order_cancellation', {
        p_order_id: order.dbId,
        p_reason: reason,
      });
      if (error) throw error;
      const { data: request, error: requestError } = await supabase.from('order_cancellation_requests')
        .select('id, order_id, buyer_id, reason, status, admin_note, created_at')
        .eq('id', requestId)
        .single();
      if (requestError) throw requestError;
      setCancellationRequests((current) => [request as CancellationRequest, ...current.filter((item) => item.id !== request.id)]);
      setCancellationReasons((current) => ({ ...current, [order.id]: '' }));
      if (request.status === 'approved') {
        setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: 'cancelled' } : item));
        setSelectedOrder((current) => current?.id === order.id ? { ...current, status: 'cancelled' } : current);
        setDashboardNotice('Your order was cancelled. Any eligible online refund will be processed manually.');
      } else {
        setDashboardNotice('Your cancellation request was sent for admin review.');
      }
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to request cancellation.'));
    }
  };

  const checkMonnifyPayment = async (order: Order) => {
    setIsCheckingPayment(true);
    setPaymentCheckMessage('');
    setAuthError('');
    try {
      const { data, error } = await supabase.functions.invoke('monnify-payment', {
        body: { action: 'verify', order_id: order.id },
      });
      if (error) throw error;
      if (data?.paid !== true) {
        setPaymentCheckMessage('Monnify still reports this payment as pending. If you have just paid, wait briefly and check again.');
        return;
      }
      const updatedOrder = { ...order, paymentStatus: 'paid' };
      setSelectedOrder(updatedOrder);
      setOrders((current) => current.map((item) => item.id === order.id ? updatedOrder : item));
      if (data?.cancelled === true) {
        setPaymentCheckMessage('Payment completed after this order was cancelled. A manual refund is pending review; please do not pay again.');
        const { data: refund, error: refundError } = await supabase.from('order_refunds')
          .select('id, order_id, buyer_id, amount, status, provider_reference, admin_note, created_at')
          .eq('order_id', order.dbId)
          .maybeSingle();
        if (refundError) throw refundError;
        if (refund) setRefundRequests((current) => [refund as RefundRequest, ...current.filter((item) => item.id !== refund.id)]);
        return;
      }
      setPaymentCheckMessage('Payment confirmed by Monnify.');
      const { error: notificationError } = await supabase.functions.invoke('notify-order-event', {
        body: { event_type: 'new_order', order_id: order.id },
      });
      if (notificationError) {
        console.error('Payment was confirmed, but seller notification dispatch failed.', notificationError);
        notify('Payment confirmed. Seller notification is pending.');
      } else {
        notify('Payment confirmed. Seller has been notified.');
      }
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to verify this Monnify payment.'));
    } finally {
      setIsCheckingPayment(false);
    }
  };

  const recordPaymentSimulation = async (order: Order, result: 'success' | 'failure') => {
    setIsCheckingPayment(true);
    setPaymentCheckMessage('');
    setAuthError('');
    try {
      const { data, error } = await supabase.functions.invoke('payment-simulator', {
        body: { action: 'result', order_id: order.id, result },
      });
      if (error) throw error;
      if (data?.result !== (result === 'success' ? 'paid' : 'failed')) {
        throw new Error('The payment simulator returned an unexpected result.');
      }
      const updatedOrder = {
        ...order,
        paymentStatus: result === 'success' ? 'paid' : 'failed',
        status: result === 'success' ? order.status : 'cancelled',
      };
      setSelectedOrder(updatedOrder);
      setOrders((current) => current.map((item) => item.id === order.id ? updatedOrder : item));
      setPaymentCheckMessage(result === 'success'
        ? 'Test payment successful. No money moved; the order is now available to the seller.'
        : 'Test payment unsuccessful. The order was cancelled and its stock was released.');
      if (result === 'success') {
        const { error: notificationError } = await supabase.functions.invoke('notify-order-event', {
          body: { event_type: 'new_order', order_id: order.id },
        });
        if (notificationError) {
          console.error('Test payment succeeded, but seller notification dispatch failed.', notificationError);
          setPaymentCheckMessage('Test payment successful. The order is available to the seller, but the notification could not be sent.');
        }
      }
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to record the simulated payment result.'));
    } finally {
      setIsCheckingPayment(false);
    }
  };

  const chooseVerificationPhoto = async (key: VerificationPhotoKey) => {
    setDashboardNotice('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access to choose a verification photo.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.base64) throw new Error('Could not read the selected photo. Please choose it again.');
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Choose a JPG, PNG, or WebP photo.');
      }
      setVerificationPhotos((current) => ({
        ...current,
        [key]: { uri: asset.uri, base64: asset.base64, mimeType },
      }));
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to select a verification photo.'));
    }
  };

  const uploadVerificationPhoto = async (key: VerificationPhotoKey) => {
    const photo = verificationPhotos[key];
    if (!photo) throw new Error('Add all requested verification photos before submitting.');
    const userData = await getCurrentAuthenticatedUser();
    if (!userData) throw new Error('Sign in before uploading verification documents.');
    const binary = atob(photo.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userData.id}/${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error } = await supabase.storage.from('verification-documents').upload(path, bytes.buffer, {
      contentType: photo.mimeType,
      upsert: false,
    });
    if (error) throw error;
    return path;
  };

  const requestStoreVerification = async () => {
    setDashboardNotice('');
    if (!sellerStoreId) {
      setDashboardNotice('Save your store profile before requesting verification.');
      return;
    }
    setIsSubmittingVerification(true);
    const uploadedPaths: string[] = [];
    try {
      const storefrontPath = await uploadVerificationPhoto('storefront');
      uploadedPaths.push(storefrontPath);
      const sellerIdPath = await uploadVerificationPhoto('sellerId');
      uploadedPaths.push(sellerIdPath);
      const { data, error } = await supabase.rpc('request_store_verification', {
        p_store_id: sellerStoreId,
        p_storefront_photo_path: storefrontPath,
        p_seller_id_path: sellerIdPath,
      });
      if (error) throw error;
      setStoreVerificationStatus(data === 'pending' ? 'pending' : 'unverified');
      setVerificationPhotos((current) => {
        const remaining = { ...current };
        delete remaining.storefront;
        delete remaining.sellerId;
        return remaining;
      });
      setDashboardNotice('Verification requested. GetBuy will review your store details and contact you.');
    } catch (error: unknown) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from('verification-documents').remove(uploadedPaths);
        if (cleanupError) console.warn('Unable to remove verification photos after submission failed.', cleanupError);
      }
      setDashboardNotice(getErrorMessage(error, 'Unable to request store verification.'));
    } finally {
      setIsSubmittingVerification(false);
    }
  };

  const requestRiderVerification = async () => {
    setDashboardNotice('');
    setIsSubmittingVerification(true);
    const uploadedPaths: string[] = [];
    try {
      const platePath = await uploadVerificationPhoto('plate');
      uploadedPaths.push(platePath);
      const roadworthinessPath = await uploadVerificationPhoto('roadworthiness');
      uploadedPaths.push(roadworthinessPath);
      const driverLicensePath = await uploadVerificationPhoto('driverLicense');
      uploadedPaths.push(driverLicensePath);
      const { data, error } = await supabase.rpc('request_rider_verification', {
        p_plate_number: riderPlateNumber.trim(),
        p_plate_photo_path: platePath,
        p_roadworthiness_photo_path: roadworthinessPath,
        p_driver_license_photo_path: driverLicensePath,
      });
      if (error) throw error;
      setRiderVerificationStatus(data === 'pending' ? 'pending' : 'unverified');
      setDashboardNotice('Rider verification submitted. You’ll be notified after the review.');
      setVerificationPhotos((current) => {
        const remaining = { ...current };
        delete remaining.plate;
        delete remaining.roadworthiness;
        delete remaining.driverLicense;
        return remaining;
      });
    } catch (error: unknown) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage.from('verification-documents').remove(uploadedPaths);
        if (cleanupError) console.warn('Unable to remove rider verification photos after submission failed.', cleanupError);
      }
      setDashboardNotice(getErrorMessage(error, 'Unable to submit rider verification.'));
    } finally {
      setIsSubmittingVerification(false);
    }
  };

  const reviewStoreVerification = async (storeId: string, approved: boolean) => {
    setDashboardNotice('');
    setIsReviewingVerification(storeId);
    try {
      const { error } = await supabase.rpc('review_store_verification', {
        p_store_id: storeId,
        p_approved: approved,
      });
      if (error) throw error;
      setVerificationRequests((requests) => requests.filter((request) => request.store_id !== storeId));
      setAdminSnapshot((current) => current ? {
        ...current,
        metrics: {
          ...current.metrics,
          pending_verification: Math.max(0, current.metrics.pending_verification - 1),
        },
        stores: current.stores.map((store) => store.id === storeId
          ? { ...store, verification_status: approved ? 'verified' : 'rejected' }
          : store),
      } : current);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update store verification.'));
    } finally {
      setIsReviewingVerification(null);
    }
  };

  const reviewRiderVerification = async (request: RiderVerificationRequest, approved: boolean) => {
    setDashboardNotice('');
    setIsReviewingVerification(request.verification_id);
    try {
      const { error } = await supabase.rpc('review_rider_verification', {
        p_verification_id: request.verification_id,
        p_approved: approved,
      });
      if (error) throw error;
      setRiderVerificationRequests((requests) => requests.filter((item) => item.verification_id !== request.verification_id));
      setAdminSnapshot((current) => current ? {
        ...current,
        metrics: {
          ...current.metrics,
          pending_rider_verification: Math.max(0, current.metrics.pending_rider_verification - 1),
        },
        delivery_partners: current.delivery_partners.map((rider) => rider.id === request.rider_id
          ? {
            ...rider,
            verification_status: approved ? 'verified' : 'rejected',
            plate_number: request.plate_number,
          }
          : rider),
      } : current);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update rider verification.'));
    } finally {
      setIsReviewingVerification(null);
    }
  };

  const setAdminProductAvailability = async (product: AdminProductRow) => {
    setDashboardNotice('');
    setAdminProductBusyId(product.id);
    try {
      const { error } = await supabase.rpc('admin_set_product_availability', {
        p_product_id: product.id,
        p_is_available: !product.is_available,
      });
      if (error) throw error;
      setAdminSnapshot((current) => current ? {
        ...current,
        products: current.products.map((item) => item.id === product.id
          ? { ...item, is_available: !product.is_available }
          : item),
      } : current);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update product availability.'));
    } finally {
      setAdminProductBusyId(null);
    }
  };

  const reviewOrderCancellation = async (request: CancellationRequest, approve: boolean) => {
    const note = adminCancellationNotes[request.id] ?? request.admin_note ?? '';
    try {
      const { error } = await supabase.rpc('admin_review_order_cancellation', {
        p_request_id: request.id,
        p_approve: approve,
        p_admin_note: note,
      });
      if (error) throw error;
      setAdminRefreshKey((value) => value + 1);
      setDashboardNotice(approve ? 'Cancellation approved and stock restored.' : 'Cancellation request declined.');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to review this cancellation request.'));
    }
  };

  const updateOrderRefund = async (refund: RefundRequest) => {
    const draft = adminRefundDrafts[refund.id] || {
      status: refund.status === 'pending_manual' ? 'processing' : refund.status,
      reference: refund.provider_reference || '',
      note: refund.admin_note || '',
    };
    try {
      const { error } = await supabase.rpc('admin_update_order_refund', {
        p_refund_id: refund.id,
        p_status: draft.status,
        p_provider_reference: draft.reference,
        p_admin_note: draft.note,
      });
      if (error) throw error;
      setAdminRefreshKey((value) => value + 1);
      setDashboardNotice('Refund status updated. The buyer has been notified.');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update refund status.'));
    }
  };

  const contactStoreOwner = async (emailAddress: string) => {
    try {
      await Linking.openURL(`mailto:${emailAddress}`);
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to open your email app.'));
    }
  };

  const openSellerStore = async () => {
    setAuthError('');
    if (!isSupabaseConfigured) {
      setAuthError('Store setup requires Supabase configuration.');
      return;
    }
    setIsSavingStore(true);
    try {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Your session has expired. Sign in again before opening your store.');
      const { data: existingStore, error: lookupError } = await supabase
        .from('stores')
        .select('id')
        .eq('owner_id', userData.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (lookupError) throw lookupError;
      const storePayload = {
        name: storeName.trim(),
        category: storeCategory.trim(),
        market_area: storeArea.trim(),
        pickup_details: pickupDetails.trim(),
        description: storeDescription.trim(),
      };
      const storeRequest = existingStore
        ? supabase.from('stores').update(storePayload).eq('id', existingStore.id)
        : supabase.from('stores').insert({ ...storePayload, owner_id: userData.id });
      const { error: storeError } = await storeRequest;
      if (storeError) throw storeError;
      if (isEditingProfile) setStoreVerificationStatus('unverified');
      setIsEditingProfile(false);
      setScreen(isEditingProfile ? 'sellerDashboard' : 'complete');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to open your store.'));
    } finally {
      setIsSavingStore(false);
    }
  };

  const saveBuyerLocation = async () => {
    setAuthError('');
    if (isGuestBrowsing) {
      if (!location.trim()) {
        setAuthError('Enter your delivery location before continuing.');
        return;
      }
      setIsEditingProfile(false);
      setScreen('dashboard');
      return;
    }
    if (!isSupabaseConfigured) {
      setAuthError('Saving your location requires Supabase configuration.');
      return;
    }
    setIsSavingLocation(true);
    try {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before saving your location.');
      const { error } = await supabase.from('profiles')
        .update({ location: location.trim(), area: area.trim(), directions: directions.trim() })
        .eq('id', userData.id);
      if (error) throw error;
      const returnScreen = isEditingProfile ? 'dashboard' : 'complete';
      setIsEditingProfile(false);
      setScreen(returnScreen);
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to save your location.'));
    } finally {
      setIsSavingLocation(false);
    }
  };

  const useCurrentLocation = async () => {
    setAuthError('');
    setIsGettingCurrentLocation(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Location permission was not granted. You can still enter your address manually.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinates = `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
      const [address] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const addressLine = address
        ? [address.name, [address.streetNumber, address.street].filter(Boolean).join(' '), address.city, address.region, address.postalCode]
          .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
          .join(', ')
        : '';
      const nearbyArea = address?.district || address?.subregion || address?.city || address?.region || '';

      if (role === 'delivery') {
        if (nearbyArea) {
          setServiceArea(nearbyArea);
          setArea(nearbyArea);
        }
        setLocation(addressLine || coordinates);
      } else {
        setLocation(addressLine || coordinates);
        if (nearbyArea) setArea(nearbyArea);
      }

      if (!addressLine) {
        setAuthError('Your coordinates were found, but no street address was available. Review the location and add a delivery address if needed.');
      } else {
        notify('Current location added. You can edit the address before saving.');
      }
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to get your current location. Enter your address manually instead.'));
    } finally {
      setIsGettingCurrentLocation(false);
    }
  };

  const saveDeliveryProfile = async () => {
    setAuthError('');
    if (!isSupabaseConfigured) {
      setAuthError('Delivery profile setup requires Supabase configuration.');
      return;
    }
    try {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before setting up delivery.');
      const { error: profileError } = await supabase.from('profiles')
        .update({
          full_name: name.trim(),
          phone_number: signupPhone.trim(),
          location: location.trim() || serviceArea.trim(),
          area: serviceArea.trim(),
        })
        .eq('id', userData.id);
      if (profileError) throw profileError;
      const { error: partnerError } = await supabase.from('delivery_partners').upsert({
        id: userData.id,
        vehicle_type: vehicle.trim(),
        is_available: false,
      });
      if (partnerError) throw partnerError;
      setIsEditingProfile(false);
      setScreen('deliveryDashboard');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to save your delivery profile.'));
    }
  };

  const updateDeliveryAvailability = async () => {
    try {
      if (deliveryStatus !== 'Available' && riderVerificationStatus !== 'verified') {
        setDashboardNotice('Complete rider verification and wait for approval before going online.');
        return;
      }
      const nextStatus = deliveryStatus === 'Available' ? false : true;
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before changing delivery availability.');
      const { error } = await supabase.from('delivery_partners')
        .update({ is_available: nextStatus })
        .eq('id', userData.id);
      if (error) throw error;
      setDeliveryStatus(nextStatus ? 'Available' : 'Offline');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update delivery availability.'));
    }
  };

  const claimDeliveryOrder = async (orderId: string) => {
    try {
      const { data, error } = await supabase.rpc('claim_delivery_order', { p_order_id: orderId });
      if (error) throw error;
      if (!data) throw new Error('Another delivery partner has already accepted this order.');
      setDashboardNotice('Order accepted. It is now assigned to you.');
      setDeliveryOrders((current) => current.map((order) => order.id === orderId ? { ...order, assignedToCurrent: true } : order));
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to accept this delivery.'));
    }
  };

  const startDeliveryOrder = async (orderId: string) => {
    try {
      const { error } = await supabase.from('orders')
        .update({ status: 'out_for_delivery', updated_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw error;
      setDeliveryOrders((current) => current.map((order) => order.id === orderId ? { ...order, status: 'out_for_delivery' } : order));
      setDashboardNotice('Order is now marked out for delivery.');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to update this delivery.'));
    }
  };

  const captureDeliveryProof = async (orderId: string) => {
    setDashboardNotice('');
    try {
      const order = deliveryOrders.find((item) => item.id === orderId);
      if (!order || !order.assignedToCurrent || order.status !== 'out_for_delivery') {
        throw new Error('Only the assigned rider can add delivery proof for an active delivery.');
      }
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Allow camera access to take a delivery proof photo.');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.7,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const base64 = asset.base64;
      if (!base64) throw new Error('Could not read the selected photo. Please choose it again.');
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Choose a JPG, PNG, or WebP delivery photo.');
      }
      if (Math.ceil(base64.length * 3 / 4) > 8 * 1024 * 1024) {
        throw new Error('Choose a delivery photo smaller than 8 MB.');
      }
      setDeliveryProofDrafts((current) => ({
        ...current,
        [orderId]: { uri: asset.uri, base64, mimeType },
      }));
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to select delivery proof.'));
    }
  };

  const finishDeliveryOrder = async (orderId: string) => {
    const photo = deliveryProofDrafts[orderId];
    if (!photo) {
      setDashboardNotice('Add a delivery photo before marking this order delivered.');
      return;
    }
    setDashboardNotice('');
    setSubmittingDeliveryProofId(orderId);
    try {
      const userData = await getCurrentAuthenticatedUser();
      if (!userData) throw new Error('Sign in before completing this delivery.');
      const binary = atob(photo.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const proofPath = `${orderId}/${userData.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('delivery-proofs').upload(proofPath, bytes.buffer, {
        contentType: photo.mimeType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error } = await supabase.rpc('complete_delivery_with_proof', {
        p_order_id: orderId,
        p_delivery_proof_path: proofPath,
      });
      if (error) throw error;
      setDeliveryOrders((current) => current.map((order) => order.id === orderId
        ? { ...order, status: 'completed', updatedAt: new Date().toISOString() }
        : order));
      setDeliveryProofDrafts((current) => {
        const remaining = { ...current };
        delete remaining[orderId];
        return remaining;
      });
      setDashboardNotice('Delivery photo saved and order marked complete. The buyer can now review the photo and confirm receipt.');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to complete this delivery.'));
    } finally {
      setSubmittingDeliveryProofId('');
    }
  };

  const savePayoutAccount = async () => {
    setAuthError('');
    setIsSavingPayoutAccount(true);
    try {
      const { error } = await supabase.rpc('save_my_payout_account', {
        p_bank_name: payoutBankName,
        p_account_name: payoutAccountName,
        p_account_number: payoutAccountNumber,
      });
      if (error) throw error;
      notify('Payout bank details saved');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to save payout bank details.'));
    } finally {
      setIsSavingPayoutAccount(false);
    }
  };

  const submitCodRemittance = async (orderId: string) => {
    setDashboardNotice('');
    setSubmittingRemittanceId(orderId);
    try {
      const { data, error } = await supabase.rpc('submit_cod_remittance', {
        p_order_id: orderId,
        p_transfer_reference: remittanceReferences[orderId] || '',
      });
      if (error) throw error;
      if (data !== 'pending') throw new Error('Remittance was not queued for review.');
      setRiderRemittances((current) => ({
        ...current,
        [orderId]: {
          order_id: orderId,
          expected_amount: deliveryOrders.find((order) => order.id === orderId)?.total || 0,
          status: 'pending',
          transfer_reference: (remittanceReferences[orderId] || '').trim(),
        },
      }));
      setDashboardNotice('Remittance submitted. GetBuy will confirm the transfer before processing your payout.');
    } catch (error: unknown) {
      setDashboardNotice(getErrorMessage(error, 'Unable to submit the remittance.'));
    } finally {
      setSubmittingRemittanceId('');
    }
  };

  const chooseProductImage = async () => {
    setAuthError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setAuthError('Allow photo access to choose a product image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 6],
        base64: true,
        quality: 0.8,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        setNewProductImage(asset.uri);
        setNewProductImageBase64(asset.base64 ?? null);
        setNewProductImageMimeType(asset.mimeType ?? 'image/jpeg');
      }
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Unable to open the photo library.'));
    }
  };

  if (!isHydrated) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.loadingState}>
          <BrandMark />
          <Text style={styles.loadingText}>Loading getBuy...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (showSplash || !isHydrated) {
    return <SplashScreen />;
  }

  const getRoleHomeScreen = (): Screen => role === 'seller'
    ? 'sellerDashboard'
    : role === 'delivery'
      ? 'deliveryDashboard'
      : role === 'admin'
        ? 'adminSetup'
        : 'dashboard';

  const openTerms = (returnScreen: Screen) => {
    setTermsReturnScreen(returnScreen);
    setScreen('terms');
  };

  const goBack = () => {
    if (screen === 'welcome') return;
    if (screen === 'terms') setScreen(termsReturnScreen);
    else if (screen === 'auth') setScreen('welcome');
    else if (screen === 'verifySignup') {
      setAuthError('');
      setSignupNotice('');
      setSignupCode('');
      setScreen('create');
    }
    else if (screen === 'forgotPassword') {
      setRecoveryError('');
      setRecoveryNotice('');
      setScreen('signin');
    } else if (screen === 'verifyRecovery') {
      setRecoveryError('');
      setRecoveryNotice('');
      setScreen('forgotPassword');
    } else if (screen === 'newPassword') {
      setRecoveryError('');
      setRecoveryNotice('');
      setScreen('verifyRecovery');
    }
    else if (screen === 'signin') {
      if (checkoutAfterAuth.current) {
        setScreen('checkout');
      } else if (isGuestBrowsing) {
        setScreen('welcome');
      } else if (hasRegisteredAccount) {
        setScreen('welcome');
      } else {
        if (role === 'admin') setRole('buyer');
        setScreen('roleChoice');
      }
    }
    else if (screen === 'create') {
      if (checkoutAfterAuth.current) {
        checkoutAfterAuth.current = false;
        setScreen('checkout');
      } else {
        setScreen('auth');
      }
    }
    else if (screen === 'sellerSetup') setScreen(isEditingProfile ? 'sellerDashboard' : 'create');
    else if (screen === 'deliverySetup') setScreen(isEditingProfile ? 'deliveryDashboard' : 'create');
    else if (screen === 'location') setScreen(isEditingProfile ? 'dashboard' : 'create');
    else if (screen === 'complete') setScreen(role === 'seller' ? 'sellerSetup' : role === 'delivery' ? 'deliverySetup' : role === 'admin' ? 'adminSetup' : 'location');
    else if (screen === 'cart' || screen === 'orders' || screen === 'notifications') setScreen(getRoleHomeScreen());
    else if (screen === 'tracking') setScreen('orders');
    else if (screen === 'profile') setScreen(getRoleHomeScreen());
    else if (screen === 'adminSetup') setScreen('welcome');
    else if (screen === 'productDetail') setScreen('dashboard');
    else if (screen === 'deliveryDashboard') setScreen('welcome');
    else if (screen === 'adminDashboard') setScreen('welcome');
    else setScreen('welcome');
  };

  if (screen === 'terms') {
    return (
      <Shell>
        <BackButton onPress={goBack} />
        <Text style={styles.pageTitleLeft}>Terms and Conditions</Text>
        <Text style={styles.pageDescriptionLeft}>Last updated {TERMS_LAST_UPDATED}</Text>
        <Text style={styles.termsIntro}>Please read these terms before using GetBuy.</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} style={styles.termsSection}>
            <Text style={styles.termsSectionTitle}>{section.title}</Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={styles.termsSectionText}>{paragraph}</Text>
            ))}
          </View>
        ))}
        <Text style={styles.termsReviewNote}>These terms are a working draft and should be reviewed by Nigerian legal counsel before public launch.</Text>
      </Shell>
    );
  }

  if (screen === 'welcome') {
    return (
      <Shell>
        <View style={styles.welcomeBrand}><LogoLockup /></View>
        <Image
          accessibilityLabel="Basket of fresh local vegetables"
          source={{ uri: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85' }}
          style={styles.welcomeHero}
        />
        <View style={styles.welcomePill}><Text style={styles.welcomePillText}>YOUR LOCAL MARKET, CLOSER</Text></View>
        <Text style={styles.welcomeTitle}>Good food.{'\n'}Good neighbours.</Text>
        <Text style={styles.welcomeDescription}>Find fresh groceries from local growers and vendors. Order for delivery or collection agreed with your seller.</Text>
        <View style={styles.footer}>
          <PrimaryButton
            label={hasRegisteredAccount ? 'Sign in to your account' : "Let's get started"}
            onPress={() => {
              if (hasRegisteredAccount) {
                setScreen('signin');
              } else {
                setRole('buyer');
                setIsGuestBrowsing(true);
                setScreen('dashboard');
              }
            }}
          />
          {hasRegisteredAccount ? (
            <Pressable onPress={() => { setRole('buyer'); setScreen('roleChoice'); }} style={styles.welcomeSignIn}>
              <Text style={styles.welcomeSignInText}>Create another account</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={() => { setRole('buyer'); setIsGuestBrowsing(true); setScreen('signin'); }} style={styles.welcomeSignIn}>
                <Text style={styles.welcomeSignInText}>Already part of getBuy? Sign in</Text>
              </Pressable>
              <Pressable onPress={() => setScreen('roleChoice')} style={styles.welcomeSignIn}>
                <Text style={styles.welcomeSignInText}>Selling or delivering? Join as a partner</Text>
              </Pressable>
            </>
          )}
        </View>
      </Shell>
    );
  }

  if (screen === 'roleChoice') {
    return (
      <Shell>
        <View style={styles.localvegRowHeader}>
          <LogoLockup green />
        </View>
        <Text style={styles.freshStartBadge}>A FRESH START</Text>
        <Text style={styles.roleChoiceTitle}>{`Your\nneighbourhood.\nYour marketplace.`}</Text>
        <Text style={styles.roleChoiceQuestion}>How would you like to use getBuy?</Text>

        <Pressable onPress={() => setRole('buyer')} style={[styles.roleChoiceCard, role === 'buyer' && styles.roleChoiceCardSelected]}>
          <View style={styles.roleChoiceIconWrap}><Ionicons color="#143A73" name="basket-outline" size={27} /></View>
          <View style={styles.roleChoiceTextWrap}>
            <Text style={styles.roleChoiceCardTitle}>I&apos;m buying groceries</Text>
            <Text style={styles.roleChoiceCardDescription}>Find fresh food for your household.</Text>
          </View>
          <View style={[styles.roleChoiceRadio, role === 'buyer' && styles.roleChoiceRadioSelected]}>{role === 'buyer' ? <Ionicons color="#FFF" name="checkmark" size={17} /> : null}</View>
        </Pressable>

        <Pressable onPress={() => setRole('seller')} style={[styles.roleChoiceCard, role === 'seller' && styles.roleChoiceCardSelected]}>
          <View style={styles.roleChoiceIconWrap}><Ionicons color="#143A73" name="storefront-outline" size={27} /></View>
          <View style={styles.roleChoiceTextWrap}>
            <Text style={styles.roleChoiceCardTitle}>I&apos;m a seller</Text>
            <Text style={styles.roleChoiceCardDescription}>List produce and manage orders.</Text>
          </View>
          <View style={[styles.roleChoiceRadio, role === 'seller' && styles.roleChoiceRadioSelected]}>{role === 'seller' ? <Ionicons color="#FFF" name="checkmark" size={17} /> : null}</View>
        </Pressable>

        <Pressable onPress={() => setRole('delivery')} style={[styles.roleChoiceCard, role === 'delivery' && styles.roleChoiceCardSelected]}>
          <View style={styles.roleChoiceIconWrap}><Ionicons color="#143A73" name="bicycle-outline" size={27} /></View>
          <View style={styles.roleChoiceTextWrap}>
            <Text style={styles.roleChoiceCardTitle}>I&apos;m a delivery partner</Text>
            <Text style={styles.roleChoiceCardDescription}>Collect orders and deliver locally.</Text>
          </View>
          <View style={[styles.roleChoiceRadio, role === 'delivery' && styles.roleChoiceRadioSelected]}>{role === 'delivery' ? <Ionicons color="#FFF" name="checkmark" size={17} /> : null}</View>
        </Pressable>

        <Pressable onPress={() => { setAuthError(''); if (!role) setRole('buyer'); setScreen('create'); }} style={styles.roleChoicePrimaryButton}>
          <Text style={styles.roleChoicePrimaryButtonText}>{role === 'seller' ? 'Continue as a seller' : role === 'delivery' ? 'Continue as a delivery partner' : 'Continue as a buyer'}</Text>
        </Pressable>
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}

        <Pressable onPress={() => setScreen('signin')} style={styles.roleChoiceSecondaryTextWrap}>
          <Text style={styles.roleChoiceSecondaryText}>Already have an account? Sign in</Text>
        </Pressable>

      </Shell>
    );
  }

  if (screen === 'notifications') {
    return (
      <Shell toast={toast}>
        <View style={styles.profileTopBar}>
          <BackButton onPress={goBack} />
          <Text style={styles.pageTitleLeft}>Notifications</Text>
          <View style={styles.notificationCountPill}>
            <Text style={styles.notificationCountText}>{notifications.filter((item) => !item.read_at).length + marketplaceAlerts.filter((item) => !item.read_at).length} new</Text>
          </View>
        </View>
        {notificationError ? <Text style={styles.authError}>{notificationError}</Text> : null}
        {pushSetupNotice ? <Text style={styles.notificationSetupHint}>{pushSetupNotice}</Text> : null}
        {notifications.length === 0 && marketplaceAlerts.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}><Ionicons color="#1B4D8F" name="notifications-outline" size={44} /></View>
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.emptyText}>New orders and delivery pickup alerts will show up here.</Text>
          </View>
        ) : notifications.map((notification) => (
          <Pressable
            key={notification.id}
            accessibilityRole="button"
            onPress={() => { void openNotification(notification); }}
            style={[styles.notificationCard, !notification.read_at && styles.notificationCardUnread]}
          >
            <View style={styles.notificationIcon}>
              <Ionicons
                color="#143A73"
                name={notification.event_type === 'new_order'
                  ? 'bag-handle-outline'
                  : notification.event_type === 'new_chat_message'
                    ? 'chatbubble-ellipses-outline'
                    : notification.event_type.includes('stock')
                      ? 'leaf-outline'
                      : notification.event_type.includes('reward')
                        ? 'sparkles-outline'
                        : notification.event_type.includes('refund') || notification.event_type.includes('cancellation')
                          ? 'card-outline'
                          : 'bicycle-outline'}
                size={21}
              />
            </View>
            <View style={styles.notificationCopy}>
              <Text style={styles.notificationTitle}>{notification.title}</Text>
              <Text style={styles.notificationBody}>{notification.body}</Text>
              <Text style={styles.notificationTime}>{new Date(notification.created_at).toLocaleString()}</Text>
            </View>
            {!notification.read_at ? <View style={styles.notificationUnreadDot} /> : null}
          </Pressable>
        ))}
        {marketplaceAlerts.length ? (
          <>
            <Text style={styles.dashboardSectionTitle}>Marketplace alerts</Text>
            {marketplaceAlerts.map((alert) => (
              <Pressable
                key={alert.id}
                accessibilityRole="button"
                onPress={() => void markMarketplaceAlertRead(alert)}
                style={[styles.notificationCard, !alert.read_at && styles.notificationCardUnread]}
              >
                <View style={styles.notificationIcon}>
                  <Ionicons color="#143A73" name={alert.alert_type === 'back_in_stock' ? 'leaf-outline' : 'warning-outline'} size={21} />
                </View>
                <View style={styles.notificationCopy}>
                  <Text style={styles.notificationTitle}>{alert.alert_type === 'back_in_stock' ? 'Back in stock' : 'Low stock'}</Text>
                  <Text style={styles.notificationBody}>{alert.message}</Text>
                  <Text style={styles.notificationTime}>{new Date(alert.created_at).toLocaleString()}</Text>
                </View>
                {!alert.read_at ? <View style={styles.notificationUnreadDot} /> : null}
              </Pressable>
            ))}
          </>
        ) : null}
      </Shell>
    );
  }

  if (screen === 'profile') {
    const profilePhotoUrl = profilePhotoPath
      ? `${supabase.storage.from('profile-photos').getPublicUrl(profilePhotoPath).data.publicUrl}?v=${profilePhotoVersion}`
      : null;
    const roleLabel = role === 'buyer' ? 'Buyer' : role === 'seller' ? 'Seller' : role === 'delivery' ? 'Delivery partner' : 'Administrator';
    const roleStats = role === 'seller'
      ? [
          { label: 'Listings', value: String(inventory.length) },
          { label: 'Available', value: String(inventory.filter((item) => item.isAvailable).length) },
          { label: 'Open orders', value: String(sellerOrders.filter((order) => !['completed', 'cancelled'].includes(order.status)).length) },
        ]
      : role === 'delivery'
        ? [
            { label: 'Active jobs', value: String(deliveryOrders.filter((order) => order.assignedToCurrent && ['ready', 'out_for_delivery'].includes(order.status)).length) },
            { label: 'Completed', value: String(deliveryOrders.filter((order) => order.assignedToCurrent && order.status === 'completed').length) },
            { label: 'Status', value: deliveryStatus },
          ]
        : [
            { label: 'Saved', value: String(saved.length) },
            { label: 'In cart', value: String(getCartCount(cart)) },
            { label: 'Orders', value: String(orders.length) },
          ];
    const profileLocation = role === 'seller'
      ? [storeArea, pickupDetails].filter(Boolean).join(' · ')
      : role === 'delivery'
        ? serviceArea || location
        : location;

    return (
      <Shell>
        <View style={styles.profileTopBar}>
          <BackButton onPress={goBack} />
          <LogoLockup compact />
        </View>
        <View style={styles.profileHero}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a profile picture" disabled={isUploadingProfilePhoto} onPress={chooseProfilePhoto} style={styles.profileAvatarLarge}>
            {profilePhotoUrl
              ? <Image accessibilityLabel="Profile picture" source={{ uri: profilePhotoUrl }} style={styles.profileAvatarImage} />
              : <Text style={styles.profileAvatarLargeText}>{name.trim() ? name.trim().charAt(0).toUpperCase() : 'G'}</Text>}
            <View style={styles.profileAvatarEdit}><Ionicons color="#FFF" name="camera" size={13} /></View>
          </Pressable>
          <View style={styles.profileHeroCopy}>
            <View style={styles.profileRoleBadge}><Text style={styles.profileRoleBadgeText}>{roleLabel.toUpperCase()}</Text></View>
            <Text style={styles.profileHeroName}>{name || 'Welcome to getBuy'}</Text>
            <Text style={styles.profileHeroEmail}>{email || 'Add an email to your account'}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" disabled={isUploadingProfilePhoto} onPress={chooseProfilePhoto} style={styles.profilePhotoAction}>
          <Text style={styles.profilePhotoActionText}>{isUploadingProfilePhoto ? 'Uploading picture…' : profilePhotoPath ? 'Change profile picture' : 'Add a profile picture'}</Text>
        </Pressable>

        <View style={styles.profileStatsRow}>
          {roleStats.map((stat) => (
            <View key={stat.label} style={styles.profileStatCard}>
              <Text style={styles.profileStatValue}>{stat.value}</Text>
              <Text style={styles.profileStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.profileSectionHeader}>
          <Text style={styles.profileSectionTitle}>Personal details</Text>
          {!isEditingProfileName ? (
            <Pressable onPress={() => { setAuthError(''); setIsEditingProfileName(true); }} style={styles.profileInlineAction}>
              <Text style={styles.profileInlineActionText}>Edit</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.profileDetailsCard}>
          {isEditingProfileName ? (
            <>
              <Field label="Full name" value={name} onChangeText={setName} placeholder="Your full name" />
              <View style={styles.profileEditActions}>
                <Pressable onPress={() => { setIsEditingProfileName(false); setAuthError(''); }} style={styles.profileCancelButton}>
                  <Text style={styles.profileCancelText}>Cancel</Text>
                </Pressable>
                <Pressable disabled={isSavingProfile} onPress={saveProfileName} style={[styles.profileSaveButton, isSavingProfile && styles.disabledButton]}>
                  <Text style={styles.profileSaveText}>{isSavingProfile ? 'Saving…' : 'Save name'}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.profileDetailRow}>
              <View style={styles.profileDetailIcon}><Ionicons color="#143A73" name="person-outline" size={19} /></View>
              <View style={styles.profileDetailCopy}>
                <Text style={styles.profileLabel}>Full name</Text>
                <Text style={styles.profileValue}>{name || 'Name not added'}</Text>
              </View>
            </View>
          )}
          <View style={styles.profileDetailDivider} />
          <View style={styles.profileDetailRow}>
            <View style={styles.profileDetailIcon}><Ionicons color="#143A73" name="mail-outline" size={19} /></View>
            <View style={styles.profileDetailCopy}>
              <Text style={styles.profileLabel}>Email address</Text>
              <Text style={styles.profileValue}>{email || 'Not available'}</Text>
            </View>
          </View>
          <View style={styles.profileDetailDivider} />
          <View style={styles.profileDetailRow}>
            <View style={styles.profileDetailIcon}><Ionicons color="#143A73" name="location-outline" size={19} /></View>
            <View style={styles.profileDetailCopy}>
              <Text style={styles.profileLabel}>{role === 'seller' ? 'Market & pickup' : role === 'delivery' ? 'Service area' : 'Delivery location'}</Text>
              <Text style={styles.profileValue}>{profileLocation || 'Not added yet'}</Text>
              {role === 'buyer' && directions ? <Text style={styles.profileDetailHint}>{directions}</Text> : null}
            </View>
          </View>
          {role !== 'admin' ? (
            <Pressable
              onPress={() => {
                setIsEditingProfile(true);
                setScreen(role === 'seller' ? 'sellerSetup' : role === 'delivery' ? 'deliverySetup' : 'location');
              }}
              style={styles.profileEditProfileButton}
            >
              <Text style={styles.profileEditProfileText}>{role === 'buyer' ? 'Edit delivery details' : role === 'seller' ? 'Edit store details' : 'Edit delivery profile'}</Text>
            </Pressable>
          ) : null}
        </View>

        {role === 'delivery' ? (
          <View style={styles.payoutAccountCard}>
            <Text style={styles.profileSectionTitle}>Buyer calls</Text>
            <Text style={styles.payoutAccountHint}>Your phone number is only shared with the buyer on your assigned order while it is out for delivery. You can turn sharing off at any time.</Text>
            <Field label="Phone number" value={riderPhone} onChangeText={setRiderPhone} placeholder="Enter your phone number" />
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: riderSharesPhone }}
              onPress={() => setRiderSharesPhone((sharing) => !sharing)}
              style={[styles.roleChoiceCard, riderSharesPhone && styles.roleChoiceCardSelected]}
            >
              <View style={styles.roleChoiceIconWrap}><Ionicons color="#143A73" name="call-outline" size={22} /></View>
              <View style={styles.roleChoiceTextWrap}>
                <Text style={styles.roleChoiceCardTitle}>Allow buyer calls</Text>
                <Text style={styles.roleChoiceCardDescription}>{riderSharesPhone ? 'On for active assigned deliveries' : 'Off'}</Text>
              </View>
              <Ionicons color={riderSharesPhone ? '#143A73' : '#7D91A8'} name={riderSharesPhone ? 'checkmark-circle' : 'ellipse-outline'} size={22} />
            </Pressable>
            <PrimaryButton label={isSavingRiderPhone ? 'Saving…' : 'Save call settings'} disabled={isSavingRiderPhone} onPress={() => void saveRiderCallSettings()} />
            {authError ? <Text style={styles.authError}>{authError}</Text> : null}
          </View>
        ) : null}

        {role === 'seller' || role === 'delivery' ? (
          <View style={styles.payoutAccountCard}>
            <Text style={styles.profileSectionTitle}>Bank details for payouts</Text>
            <Text style={styles.payoutAccountHint}>GetBuy pays manually after a completed order and confirms the rider’s cash remittance.</Text>
            <Field label="Bank name" value={payoutBankName} onChangeText={setPayoutBankName} placeholder="e.g. Moniepoint" />
            <Field label="Account holder name" value={payoutAccountName} onChangeText={setPayoutAccountName} placeholder="Name on the bank account" />
            <Field label="10-digit account number" value={payoutAccountNumber} onChangeText={setPayoutAccountNumber} placeholder="0123456789" keyboardType="numeric" />
            <Pressable disabled={isSavingPayoutAccount} onPress={savePayoutAccount} style={[styles.profileSaveButton, isSavingPayoutAccount && styles.disabledButton]}>
              <Text style={styles.profileSaveText}>{isSavingPayoutAccount ? 'Saving…' : 'Save payout details'}</Text>
            </Pressable>
            {payoutHistory.length ? (
              <View style={styles.payoutHistory}>
                <Text style={styles.payoutHistoryTitle}>Recent payouts</Text>
                {payoutHistory.map((payout) => (
                  <View key={`${payout.order_id}-${payout.payout_type}`} style={styles.payoutHistoryRow}>
                    <View style={styles.payoutHistoryCopy}>
                      <Text style={styles.payoutHistoryAmount}>{formatCurrency(payout.amount)}</Text>
                      <Text style={styles.payoutHistoryMeta}>Order #{payout.order_id.slice(0, 8).toUpperCase()} · {payout.status === 'paid' ? 'Paid' : payout.remittance_status === 'confirmed' ? 'Awaiting admin transfer' : 'Waiting for cash reconciliation'}</Text>
                    </View>
                    <AdminStatusPill label={payout.status} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.profileSectionTitle}>Shortcuts</Text>
        <View style={styles.profileShortcuts}>
          <Pressable onPress={() => setScreen('notifications')} style={styles.profileShortcut}>
            <Ionicons color="#143A73" name="notifications-outline" size={20} />
            <Text style={styles.profileShortcutLabel}>Notifications{notifications.some((item) => !item.read_at) || marketplaceAlerts.some((item) => !item.read_at) ? ` · ${notifications.filter((item) => !item.read_at).length + marketplaceAlerts.filter((item) => !item.read_at).length} new` : ''}</Text>
            <Ionicons color="#7D91A8" name="chevron-forward" size={18} />
          </Pressable>
          {role === 'buyer' ? (
            <>
              <Pressable onPress={() => setScreen('orders')} style={styles.profileShortcut}><Ionicons color="#143A73" name="receipt-outline" size={20} /><Text style={styles.profileShortcutLabel}>My orders</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
              <Pressable onPress={() => setScreen('saved')} style={styles.profileShortcut}><Ionicons color="#143A73" name="heart-outline" size={20} /><Text style={styles.profileShortcutLabel}>Saved products</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
              <Pressable onPress={() => setScreen('cart')} style={styles.profileShortcut}><Ionicons color="#143A73" name="cart-outline" size={20} /><Text style={styles.profileShortcutLabel}>Shopping cart</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
            </>
          ) : role === 'seller' ? (
            <>
              <Pressable onPress={() => setScreen('sellerDashboard')} style={styles.profileShortcut}><Ionicons color="#143A73" name="storefront-outline" size={20} /><Text style={styles.profileShortcutLabel}>Store overview</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
              <Pressable onPress={() => setScreen('addProduct')} style={styles.profileShortcut}><Ionicons color="#143A73" name="pricetag-outline" size={20} /><Text style={styles.profileShortcutLabel}>Manage listings</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
            </>
          ) : role === 'delivery' ? (
            <>
              <Pressable onPress={() => { setDeliveryTab('assignments'); setScreen('deliveryDashboard'); }} style={styles.profileShortcut}><Ionicons color="#143A73" name="clipboard-outline" size={20} /><Text style={styles.profileShortcutLabel}>My assignments</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
              <Pressable onPress={() => { setDeliveryTab('completed'); setScreen('deliveryDashboard'); }} style={styles.profileShortcut}><Ionicons color="#143A73" name="checkmark-done-outline" size={20} /><Text style={styles.profileShortcutLabel}>Completed deliveries</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
            </>
          ) : null}
          <Pressable onPress={resetPassword} style={styles.profileShortcut}><Ionicons color="#143A73" name="key-outline" size={20} /><Text style={styles.profileShortcutLabel}>Reset password</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
          {role === 'delivery' ? (
            <Pressable onPress={updateDeliveryAvailability} style={styles.profileShortcut}>
              <Ionicons color="#143A73" name="radio-button-on-outline" size={20} />
              <Text style={styles.profileShortcutLabel}>{deliveryStatus === 'Available' ? 'Go offline' : 'Go available'}</Text>
              <Text style={styles.profileShortcutArrow}>{deliveryStatus}</Text>
            </Pressable>
          ) : null}
          {Platform.OS !== 'web' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isBiometricBusy }}
              disabled={isBiometricBusy}
              onPress={toggleBiometricSignIn}
              style={styles.profileShortcut}
            >
              <Ionicons color="#143A73" name="finger-print-outline" size={20} />
              <Text style={styles.profileShortcutLabel}>{isBiometricBusy ? 'Updating quick unlock…' : 'Face ID / fingerprint / phone passcode'}</Text>
              <Text style={styles.profileShortcutArrow}>{biometricEnabled ? 'On' : 'Off'}</Text>
            </Pressable>
          ) : null}
          {Platform.OS !== 'web' ? (
            <Text style={styles.profileDetailHint}>Quick unlock uses this device’s saved GetBuy session; your password is never stored for this feature. Signing out removes that session.</Text>
          ) : null}
          <Pressable onPress={() => setScreen('support')} style={styles.profileShortcut}><Ionicons color="#143A73" name="help-circle-outline" size={20} /><Text style={styles.profileShortcutLabel}>Help & support</Text><Ionicons color="#7D91A8" name="chevron-forward" size={18} /></Pressable>
        </View>
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}

        <Pressable onPress={handleSignOut} style={styles.profileSignOutButton}>
          <Text style={styles.profileSignOutText}>Sign out of getBuy</Text>
        </Pressable>
      </Shell>
    );
  }

  if (screen === 'adminSetup') {
    return (
      <Shell>
        <View style={styles.localvegRowHeader}>
          <LogoLockup green />
        </View>
        <Text style={styles.sectionEyebrow}>ADMINISTRATOR</Text>
        <Text style={styles.operationsTitle}>{`Admin access is\nseparate`}</Text>
        <Text style={styles.operationsSubtitle}>Use the standalone GetBuy Admin website to sign in. Administrator accounts cannot access the marketplace app.</Text>
        <PrimaryButton label="Return to marketplace" onPress={() => setScreen('welcome')} />
      </Shell>
    );
  }

  if (screen === 'sellerDashboard') {
    return (
      <Shell
        toast={toast}
      >
        <View style={styles.sellerHeader}>
          <LogoLockup compact />
          <View style={styles.headerActions}>
            <View style={styles.sellerPill}><Text style={styles.sellerPillText}>SELLER</Text></View>
            <NotificationButton unreadCount={notifications.filter((item) => !item.read_at).length + marketplaceAlerts.filter((item) => !item.read_at).length} onPress={() => setScreen('notifications')} />
            <Pressable accessibilityRole="button" accessibilityLabel="Open seller profile" onPress={() => setScreen('profile')} style={styles.sellerHeaderProfile}>
              <Ionicons color="#143A73" name="person-outline" size={22} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.sellerStoreMeta}>{[storeName, storeArea, pickupDetails].filter(Boolean).join(' · ') || 'Set your market and stall details in Store profile'}</Text>
        <View style={styles.sellerVerificationPanel}>
          {storeVerificationStatus === 'verified' ? (
            <StoreVerifiedMark />
          ) : storeVerificationStatus === 'pending' ? (
            <Text style={styles.sellerVerificationCopy}>Verification request pending review.</Text>
          ) : (
            <>
              <Text style={styles.sellerVerificationCopy}>
                {storeVerificationStatus === 'rejected'
                  ? 'Your previous request was not approved. Update your information and upload fresh photos to request another review.'
                  : 'Submit your store details, a storefront or stall photo, and seller identity photo. Only you and GetBuy admins can see these documents.'}
              </Text>
              <VerificationPhotoPicker label="Storefront or stall photo" photo={verificationPhotos.storefront} onPress={() => chooseVerificationPhoto('storefront')} />
              <VerificationPhotoPicker label="Seller identity photo" photo={verificationPhotos.sellerId} onPress={() => chooseVerificationPhoto('sellerId')} />
              <PrimaryButton
                label={isSubmittingVerification ? 'Submitting…' : 'Submit store for review'}
                disabled={isSubmittingVerification || !verificationPhotos.storefront || !verificationPhotos.sellerId}
                onPress={requestStoreVerification}
              />
            </>
          )}
        </View>
        <Text style={styles.sellerHeroTitle}>Morning, {storeName || name || 'seller'}.</Text>
        <Text style={styles.sellerHeroSubtitle}>Keep the shelf fresh and orders moving.</Text>

        <View style={styles.sellerMetrics}>
          <View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{sellerOrders.filter((order) => !['completed', 'cancelled'].includes(order.status)).length}</Text><Text style={styles.sellerMetricLabel}>Current orders</Text></View>
          <View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{inventory.filter((product) => product.isAvailable).length}</Text><Text style={styles.sellerMetricLabel}>Available</Text></View>
          <View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{inventory.filter((product) => !product.isAvailable).length}</Text><Text style={styles.sellerMetricLabel}>Unavailable</Text></View>
        </View>

        <Pressable onPress={() => setScreen('addProduct')} style={styles.sellerAddButton}>
          <View style={styles.sellerAddButtonContent}><Ionicons color="#FFF" name="add" size={20} /><Text style={styles.sellerAddButtonText}>Add product</Text></View>
        </Pressable>

        <Text style={styles.sellerSectionTitle}>Orders needing action</Text>
        {sellerOrders.filter((order) => ['pending', 'accepted', 'preparing', 'ready'].includes(order.status)).length === 0
          ? <Text style={styles.sellerEmptyText}>No orders need attention right now.</Text>
          : sellerOrders.filter((order) => ['pending', 'accepted', 'preparing', 'ready'].includes(order.status)).map((order) => {
          const actionLabel: Record<string, string> = { pending: 'Review & confirm order', accepted: 'Start preparing', preparing: 'Mark ready' };
          const statusLabel: Record<string, string> = { pending: 'Awaiting seller confirmation', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready for pickup' };
          const orderStatusStyle = order.status === 'pending' ? styles.sellerStatusPending : styles.sellerStatusReady;
          return (
            <View key={order.dbId} style={styles.sellerOrderCard}>
              <View style={styles.sellerOrderHeader}>
                <Text style={styles.sellerOrderId}>{order.id}</Text>
                <View style={[styles.sellerStatusPill, orderStatusStyle]}><Text style={[styles.sellerStatusText, order.status === 'pending' && styles.sellerStatusPendingText]}>{statusLabel[order.status] || order.status.replace('_', ' ')}</Text></View>
              </View>
              <Text style={styles.sellerOrderMeta}>{order.deliveryAddress ? `Delivery requested · ${order.deliveryAddress}` : 'Collection details not provided'}</Text>
              <Text style={styles.sellerOrderMeta}>Scheduled · {order.deliveryDate} · {getDeliveryWindowLabel(order.deliverySlot)}</Text>
              {order.orderItems.length > 0 ? order.orderItems.map((item) => {
                const alternatives = inventory.filter((product) =>
                  product.id !== item.productId
                  && product.isAvailable
                  && Number(product.quantity || 0) >= item.quantity
                  && product.unit === item.unit
                  && getProductUnitPrice(product) === item.unitPrice,
                );
                return (
                  <View key={item.id} style={styles.sellerSubstitutionItem}>
                    <Text style={styles.sellerOrderItem}>{item.quantity} × {item.name}</Text>
                    {item.substitutionStatus === 'pending'
                      ? <Text style={styles.sellerSubstitutionStatus}>Waiting for buyer approval</Text>
                      : item.substitutionStatus === 'accepted'
                        ? <Text style={styles.sellerSubstitutionStatus}>Buyer approved the replacement</Text>
                        : item.substitutionStatus === 'declined'
                          ? <Text style={styles.sellerSubstitutionStatus}>Buyer declined the replacement</Text>
                          : null}
                    {['pending', 'accepted', 'preparing'].includes(order.status)
                      && !['pending', 'accepted'].includes(item.substitutionStatus || '')
                      && alternatives.length > 0 ? (
                      <View style={styles.substitutionChoices}>
                        {alternatives.slice(0, 3).map((product) => (
                          <Pressable
                            accessibilityRole="button"
                            disabled={Boolean(submittingSubstitutionId)}
                            key={product.id}
                            onPress={() => void offerSubstitution(order, item, product)}
                            style={styles.substitutionChoice}
                          >
                            <Text style={styles.substitutionChoiceText}>
                              {submittingSubstitutionId === `${item.id}:${product.id}` ? 'Sending…' : `Offer ${product.name}`}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              }) : order.items.length > 0 ? order.items.map((item, index) => <Text key={`${order.dbId}-${index}`} style={styles.sellerOrderItem}>{item}</Text>) : <Text style={styles.sellerOrderItem}>Order items unavailable</Text>}
              <Text style={styles.sellerOrderTotal}>Items total {formatCurrency(order.total)}</Text>
              {order.promoCode ? <Text style={styles.sellerOrderMeta}>Promo {order.promoCode} · seller discount {formatCurrency(order.promoDiscount)} · estimated product payout {formatCurrency(Math.max(0, order.total - order.promoDiscount))}</Text> : null}
              <Text style={styles.sellerOrderAssignment}>{order.assignedDeliveryId ? 'A delivery partner is assigned.' : 'No delivery partner assigned yet.'} Pickup: {pickupDetails || 'add stall details in Store profile'}.</Text>
              <Text style={styles.sellerOrderMeta}>Scheduled · {order.deliveryDate} · {getDeliveryWindowLabel(order.deliverySlot)}</Text>
              {sellerStoreId ? <SecondaryButton label="Chat with buyer" onPress={() => void openOrderChat(order.dbId, sellerStoreId)} /> : null}
              {order.status === 'ready' ? (
                <View style={styles.sellerOrderActionDone}><Text style={styles.sellerOrderActionDoneText}>Waiting for collection</Text></View>
              ) : order.status === 'preparing' && order.orderItems.some((item) => item.substitutionStatus === 'pending') ? (
                <View style={styles.sellerOrderActionDone}><Text style={styles.sellerOrderActionDoneText}>Waiting for buyer substitution decision</Text></View>
              ) : actionLabel[order.status] ? (
                <Pressable onPress={() => advanceSellerOrder(order)} style={styles.sellerOrderAction}>
                  <Text style={styles.sellerOrderActionText}>{actionLabel[order.status]}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <View style={styles.sellerInventoryHeader}>
          <Text style={styles.sellerSectionTitle}>Your products</Text>
          <Text style={styles.inventoryMeta}>All {inventory.length} listings</Text>
        </View>
        {inventory.length === 0 ? <Text style={styles.sellerEmptyText}>Your listings will appear here after you add a product.</Text> : inventory.map((item) => (
          <View key={item.id} style={styles.sellerProductCard}>
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.groceryThumb} /> : <View style={[styles.groceryThumb, styles.productImage]}><Ionicons color="#5C7FA9" name="leaf-outline" size={26} /></View>}
            <View style={styles.sellerProductDetails}>
              <Text style={styles.groceryName}>{item.name}</Text>
              <Text style={styles.groceryStock}>{item.quantity || '0'} {item.unit || 'item'} base stock{item.variants?.length ? ` · ${item.variants.map((variant) => `${variant.name}: ${variant.stock}`).join(' · ')}` : ''}</Text>
              <Text style={styles.groceryPrice}>{item.price}</Text>
            </View>
            <View style={styles.sellerProductActions}>
              <Text style={[styles.sellerStatusPill, item.isAvailable ? styles.sellerStatusReady : styles.sellerStatusPending, styles.sellerListingStatus]}>{item.isAvailable ? 'Available' : 'Unavailable'}</Text>
              <Pressable onPress={() => editProduct(item)} hitSlop={8} style={styles.sellerActionTap}><Text style={styles.linkText}>Edit</Text></Pressable>
              <Pressable onPress={() => setProductAvailability(item, !item.isAvailable)} hitSlop={8} style={styles.sellerActionTap}>
                <Text style={styles.linkText}>{item.isAvailable ? 'Mark unavailable' : Number(item.quantity || 0) > 0 || (item.variants || []).some((variant) => variant.stock > 0) ? 'Make available' : 'Add stock to activate'}</Text>
              </Pressable>
              <Pressable onPress={() => deleteProduct(item)} hitSlop={8} style={styles.sellerActionTap}><Text style={styles.deleteActionText}>Delete</Text></Pressable>
            </View>
          </View>
        ))}

        <Text style={styles.sellerFootnote}>Stock is shown as available to order. Stock reservation and order confirmation rules depend on your marketplace setup.</Text>

        <View style={styles.featureCard}>
          <Text style={styles.productName}>Stock & sales overview</Text>
          <Text style={styles.productStore}>Sales totals cover the last 30 days of completed orders.</Text>
          {inventory.map((product) => {
            const analytics = inventoryAnalytics.find((row) => row.product_id === product.id);
            return (
              <View key={`stock-${product.id}`} style={styles.featureCard}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productStore}>{analytics?.units_sold_30d || 0} sold · {formatCurrency(Number(analytics?.sales_30d || 0))}</Text>
                {product.id ? (
                  <Field
                    label={`New stock count · ${product.unit || 'item'}`}
                    value={stockDrafts[product.id] || ''}
                    onChangeText={(value) => setStockDrafts((current) => ({ ...current, [product.id!]: value.replace(/[^0-9]/g, '') }))}
                    placeholder={product.quantity || '0'}
                    keyboardType="numeric"
                  />
                ) : null}
              </View>
            );
          })}
          <SecondaryButton label={isSavingBulkStock ? 'Updating stock…' : 'Save stock counts'} disabled={isSavingBulkStock} onPress={() => void saveBulkStock()} />
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.sellerSectionTitle}>Stock alerts</Text>
          {inventory.filter((product) => product.isAvailable && (
            (Number(product.quantity || 0) > 0 && Number(product.quantity || 0) <= 5)
            || (product.variants || []).some((variant) => variant.stock > 0 && variant.stock <= 5)
          )).length === 0
            ? <Text style={styles.sellerEmptyText}>No available listings are at or below 5 units.</Text>
            : inventory.filter((product) => product.isAvailable && (
              (Number(product.quantity || 0) > 0 && Number(product.quantity || 0) <= 5)
              || (product.variants || []).some((variant) => variant.stock > 0 && variant.stock <= 5)
            )).map((product) => (
              <Text key={product.id} style={styles.productStore}>
                {product.name} · {Number(product.quantity || 0) > 0 && Number(product.quantity || 0) <= 5 ? `${product.quantity} ${product.unit} base stock` : ''}
                {(product.variants || []).filter((variant) => variant.stock > 0 && variant.stock <= 5).map((variant) => `${variant.name}: ${variant.stock}`).join(' · ')}
              </Text>
            ))}
          {marketplaceAlerts.filter((alert) => alert.alert_type === 'low_stock').slice(0, 5).map((alert) => (
            <Pressable key={alert.id} onPress={() => void markMarketplaceAlertRead(alert)}>
              <Text style={styles.dashboardNotice}>{alert.read_at ? 'Read · ' : 'New · '}{alert.message}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.sellerSectionTitle}>10% seller promo</Text>
          <Text style={styles.productStore}>Create one seller-funded code for buyers. The discount comes from your eligible product sales, not delivery or service fees.</Text>
          {!sellerPromoActive ? (
            <Field label="Promo code" value={sellerPromoCode} onChangeText={setSellerPromoCode} placeholder="4–20 letters or numbers" />
          ) : <Text style={styles.productName}>{sellerPromoCode} · 10% off</Text>}
          <PrimaryButton
            label={isSavingPromo ? 'Saving…' : sellerPromoActive ? 'Turn off promo code' : 'Create promo code'}
            disabled={isSavingPromo || (!sellerPromoActive && !/^[a-z0-9]{4,20}$/i.test(sellerPromoCode.trim()))}
            onPress={() => void saveSellerPromo()}
          />
        </View>
        <View style={styles.sellerBalanceCard}>
          <View style={styles.sellerBalanceHeader}>
            <View>
              <Text style={styles.sellerBalanceEyebrow}>STORE EARNINGS</Text>
              <Text style={styles.sellerBalanceValue}>{sellerPayoutSummary ? formatCurrency(sellerPayoutSummary.ready_for_payout) : 'Loading…'}</Text>
              <Text style={styles.sellerBalanceCaption}>Ready for admin payout</Text>
            </View>
            <Ionicons color="#D9ECFF" name="wallet-outline" size={28} />
          </View>
          <View style={styles.sellerBalanceDetails}>
            <View style={styles.sellerBalanceDetail}>
              <Text style={styles.sellerBalanceDetailValue}>{sellerPayoutSummary ? formatCurrency(sellerPayoutSummary.awaiting_reconciliation) : '—'}</Text>
              <Text style={styles.sellerBalanceDetailLabel}>Awaiting cash reconciliation</Text>
            </View>
            <View style={styles.sellerBalanceDetail}>
              <Text style={styles.sellerBalanceDetailValue}>{sellerPayoutSummary ? formatCurrency(sellerPayoutSummary.paid_to_date) : '—'}</Text>
              <Text style={styles.sellerBalanceDetailLabel}>Paid to date</Text>
            </View>
          </View>
          <Text style={styles.sellerBalanceNote}>Seller payouts are product sales net of any seller-funded promo discounts. Buyers pay delivery and service fees separately. Ready balance is paid manually by GetBuy.</Text>
        </View>
        <View style={styles.sellerReviewsCard}>
          <Text style={styles.sellerSectionTitle}>Recent store reviews</Text>
          {sellerReviews.length === 0
            ? <Text style={styles.sellerEmptyText}>Confirmed order reviews will appear here.</Text>
            : sellerReviews.map((review, index) => (
              <View key={`${review.created_at}-${index}`} style={styles.sellerReviewRow}>
                <Text style={styles.sellerReviewRating}>{'★'.repeat(Number(review.rating))} · {review.rating}/5</Text>
                {review.review ? <Text style={styles.sellerOrderItem}>{review.review}</Text> : <Text style={styles.sellerEmptyText}>No written comment.</Text>}
                <Text style={styles.sellerReviewDate}>{new Date(review.created_at).toLocaleDateString()}</Text>
              </View>
            ))}
        </View>
        {dashboardNotice ? <Text style={styles.dashboardNotice}>{dashboardNotice}</Text> : null}
      </Shell>
    );
  }

  if (screen === 'deliveryDashboard') {
    const activeDeliveryOrders = deliveryOrders.filter((order) =>
      order.assignedToCurrent && ['ready', 'out_for_delivery'].includes(order.status),
    );
    const visibleDeliveryOrders = deliveryOrders.filter((order) =>
      (order.assignedToCurrent && ['ready', 'out_for_delivery'].includes(order.status))
      || (order.status === 'ready' && !order.assignedToCurrent),
    );
    const completedDeliveryOrders = deliveryOrders.filter((order) =>
      order.assignedToCurrent && order.status === 'completed',
    );
    const readyOrder = activeDeliveryOrders.find((order) => order.status === 'ready');

    return (
      <Shell
        toast={toast}
        footer={
          <View style={styles.deliveryTabBar}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: deliveryTab === 'assignments' }}
              onPress={() => setDeliveryTab('assignments')}
              style={styles.deliveryTab}
            >
              <Ionicons color={deliveryTab === 'assignments' ? '#FFF' : '#C9DFFF'} name="clipboard-outline" size={22} />
              <Text style={[styles.deliveryTabLabel, deliveryTab === 'assignments' && styles.deliveryTabSelected]}>Assignments</Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: deliveryTab === 'completed' }}
              onPress={() => setDeliveryTab('completed')}
              style={styles.deliveryTab}
            >
              <Ionicons color={deliveryTab === 'completed' ? '#FFF' : '#C9DFFF'} name="checkmark-done-outline" size={22} />
              <Text style={[styles.deliveryTabLabel, deliveryTab === 'completed' && styles.deliveryTabSelected]}>Completed</Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              onPress={() => setScreen('profile')}
              style={styles.deliveryTab}
            >
              <Ionicons color="#C9DFFF" name="person-outline" size={22} />
              <Text style={styles.deliveryTabLabel}>Profile</Text>
            </Pressable>
          </View>
        }
      >
        <View style={styles.deliveryHeader}>
          <LogoLockup compact />
          <View style={styles.headerActions}>
            <NotificationButton unreadCount={notifications.filter((item) => !item.read_at).length + marketplaceAlerts.filter((item) => !item.read_at).length} onPress={() => setScreen('notifications')} />
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => setScreen('profile')} style={styles.deliveryProfileButton}>
              <Ionicons color="#143A73" name="person-outline" size={23} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.deliveryEyebrow}>DELIVERY PARTNER · {(serviceArea || location || 'YOUR AREA').toUpperCase()}</Text>
        <Text style={styles.deliveryHeroTitle}>Ready, {name.trim().split(/\s+/)[0] || 'there'}?</Text>
        <Text style={styles.deliverySubtitle}>
          {readyOrder
            ? 'A pickup is ready for you at the market.'
            : activeDeliveryOrders.length
              ? 'Your delivery is in progress.'
              : 'Your next pickup will appear here when it is ready.'}
        </Text>

        <View style={styles.riderVerificationPanel}>
          <View style={styles.riderVerificationHeading}>
            <Text style={styles.riderVerificationTitle}>Rider verification</Text>
            <AdminStatusPill label={riderVerificationStatus} />
          </View>
          {riderVerificationStatus === 'verified' ? (
            <Text style={styles.riderVerificationCopy}>Vehicle plate {riderPlateNumber} is verified. You can go online when you’re ready.</Text>
          ) : riderVerificationStatus === 'pending' ? (
            <Text style={styles.riderVerificationCopy}>Your documents are being reviewed. You can go online after approval.</Text>
          ) : (
            <>
              <Text style={styles.riderVerificationCopy}>
                {riderVerificationStatus === 'rejected'
                  ? 'Your previous submission was not approved. Update the photos and submit again.'
                  : 'Add your vehicle registration number and clear photos of the required documents. Only you and GetBuy admins can see them.'}
              </Text>
              <Field label="Vehicle plate number" value={riderPlateNumber} onChangeText={setRiderPlateNumber} placeholder="e.g. ABC 123 XY" />
              <VerificationPhotoPicker label="Vehicle number plate" photo={verificationPhotos.plate} onPress={() => chooseVerificationPhoto('plate')} />
              <VerificationPhotoPicker label="Roadworthiness document" photo={verificationPhotos.roadworthiness} onPress={() => chooseVerificationPhoto('roadworthiness')} />
              <VerificationPhotoPicker label="Driver licence" photo={verificationPhotos.driverLicense} onPress={() => chooseVerificationPhoto('driverLicense')} />
              <PrimaryButton
                label={isSubmittingVerification ? 'Submitting…' : 'Submit rider verification'}
                disabled={isSubmittingVerification || !riderPlateNumber.trim() || !verificationPhotos.plate || !verificationPhotos.roadworthiness || !verificationPhotos.driverLicense}
                onPress={requestRiderVerification}
              />
            </>
          )}
        </View>

        <View style={styles.deliveryMetrics}>
          <View style={styles.deliveryMetric}>
            <Text style={styles.deliveryMetricValue}>{activeDeliveryOrders.length}</Text>
            <Text style={styles.deliveryMetricLabel}>Active assignment</Text>
          </View>
          <View style={styles.deliveryMetric}>
            <Text style={styles.deliveryMetricValue}>{completedDeliveryOrders.length}</Text>
            <Text style={styles.deliveryMetricLabel}>Delivered today</Text>
          </View>
        </View>

        <View style={styles.riderEarningsCard}>
          <Text style={styles.riderEarningsEyebrow}>RIDER EARNINGS · TODAY</Text>
          <Text style={styles.riderEarningsToday}>{riderPayoutSummary ? formatCurrency(riderPayoutSummary.earned_today) : 'Loading…'}</Text>
          <View style={styles.riderEarningsDetails}>
            <View style={styles.riderEarningsDetail}>
              <Text style={styles.riderEarningsAmount}>{riderPayoutSummary ? formatCurrency(riderPayoutSummary.awaiting_reconciliation) : '—'}</Text>
              <Text style={styles.riderEarningsLabel}>Waiting for cash reconciliation</Text>
            </View>
            <View style={styles.riderEarningsDetail}>
              <Text style={styles.riderEarningsAmount}>{riderPayoutSummary ? formatCurrency(riderPayoutSummary.ready_for_payout) : '—'}</Text>
              <Text style={styles.riderEarningsLabel}>Ready for admin payout</Text>
            </View>
            <View style={styles.riderEarningsDetail}>
              <Text style={styles.riderEarningsAmount}>{riderPayoutSummary ? formatCurrency(riderPayoutSummary.paid_to_date) : '—'}</Text>
              <Text style={styles.riderEarningsLabel}>Paid to date</Text>
            </View>
          </View>
          <Text style={styles.riderEarningsNote}>₦1,500 is earned per completed delivery. Payouts are sent manually by GetBuy.</Text>
        </View>

        {deliveryTab === 'assignments' ? (
          <>
            <View style={styles.deliverySectionHeader}>
              <Text style={styles.deliverySectionTitle}>Your next pickup</Text>
              <Pressable onPress={updateDeliveryAvailability} style={styles.deliveryAvailability}>
                <View style={[styles.deliveryAvailabilityDot, deliveryStatus === 'Available' && styles.deliveryAvailabilityDotOn]} />
                <Text style={styles.deliveryAvailabilityText}>{deliveryStatus}</Text>
              </Pressable>
            </View>
            {visibleDeliveryOrders.length === 0 ? (
              <View style={styles.deliveryEmptyCard}>
                <Text style={styles.deliveryEmptyTitle}>No active assignments</Text>
                <Text style={styles.deliveryEmptyText}>Ready orders in your market will appear here.</Text>
              </View>
            ) : visibleDeliveryOrders.map((order) => {
              const isReady = order.status === 'ready';
              const statusLabel = isReady ? 'Ready for pickup' : 'In transit';
              return (
                <View key={order.id} style={styles.deliveryOrderCard}>
                  <View style={styles.deliveryOrderTop}>
                    <Text style={styles.deliveryOrderId}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
                    <View style={styles.deliveryStatusPill}><Text style={styles.deliveryStatusPillText}>{statusLabel}</Text></View>
                  </View>
                  <Text style={styles.deliveryAssignmentMeta}>
                    {order.assignedToCurrent ? 'Assigned to you' : 'Ready to claim'} · {order.deliveryDate} · {getDeliveryWindowLabel(order.deliverySlot)}
                  </Text>
                  <View style={styles.deliveryProgress}>
                    <View style={[styles.deliveryProgressLine, styles.deliveryProgressActive]} />
                    <View style={[styles.deliveryProgressLine, !isReady && styles.deliveryProgressActive]} />
                    <View style={styles.deliveryProgressLine} />
                  </View>
                  <View style={styles.deliveryProgressLabels}>
                    <Text style={styles.deliveryProgressLabel}>Assigned</Text>
                    <Text style={styles.deliveryProgressLabel}>{isReady ? 'Collect' : 'Collected'}</Text>
                    <Text style={styles.deliveryProgressLabel}>Deliver</Text>
                  </View>

                  <View style={styles.deliveryInfoRow}>
                    <View style={styles.deliveryInfoIcon}><Ionicons color="#143A73" name="storefront-outline" size={21} /></View>
                    <View style={styles.deliveryInfoCopy}>
                      <Text style={styles.deliveryInfoEyebrow}>PICKUP · SELLER</Text>
                      <Text style={styles.deliveryInfoTitle}>{order.pickupDetails.split(' · ')[0]}</Text>
                      <Text style={styles.deliveryInfoBody}>{order.pickupDetails.split(' · ').slice(1).join(' · ') || 'Seller pickup details'}</Text>
                    </View>
                  </View>
                  <View style={styles.deliveryInfoRow}>
                    <View style={styles.deliveryInfoIcon}><Ionicons color="#143A73" name="location-outline" size={21} /></View>
                    <View style={styles.deliveryInfoCopy}>
                      <Text style={styles.deliveryInfoEyebrow}>DELIVER TO · BUYER</Text>
                      <Text style={styles.deliveryInfoTitle}>{order.buyerName}</Text>
                      <Text style={styles.deliveryInfoBody}>{[order.deliveryAddress, order.buyerDirections].filter(Boolean).join('. ')}</Text>
                    </View>
                  </View>

                  <View style={styles.deliveryCheckCard}>
                    <Text style={styles.deliveryCheckTitle}>Check before collecting</Text>
                    <Text style={styles.deliveryInfoBody}>{order.itemsSummary}</Text>
                    {order.paymentMethod === 'cash_on_delivery' ? (
                      <Text style={styles.deliveryInfoBody}>Collect {formatCurrency(order.total)} cash from the buyer on delivery</Text>
                    ) : order.paymentMethod === 'monnify' ? (
                      <Text style={styles.deliveryInfoBody}>
                        {order.paymentSimulated ? 'Test payment marked successful. Do not collect cash.' : 'Paid online. Do not collect cash.'}
                      </Text>
                    ) : (
                      <Text style={styles.deliveryInfoBody}>Payment method unavailable. Confirm with GetBuy before collecting any money.</Text>
                    )}
                  </View>

                  {!order.assignedToCurrent && isReady ? (
                    <Pressable
                      disabled={deliveryStatus !== 'Available'}
                      onPress={() => claimDeliveryOrder(order.id)}
                      style={[styles.deliveryPrimaryButton, deliveryStatus !== 'Available' && styles.disabledButton]}
                    >
                      <Text style={styles.deliveryPrimaryButtonText}>Accept this assignment</Text>
                    </Pressable>
                  ) : isReady ? (
                    <Pressable onPress={() => startDeliveryOrder(order.id)} style={styles.deliveryPrimaryButton}>
                      <View style={styles.deliveryPrimaryButtonContent}><Ionicons color="#FFF" name="cube-outline" size={18} /><Text style={styles.deliveryPrimaryButtonText}>Mark collected · start delivery</Text></View>
                    </Pressable>
                  ) : (
                    <View>
                      <SecondaryButton
                        label={deliveryProofDrafts[order.id] ? 'Retake delivery photo' : 'Take delivery photo'}
                        onPress={() => void captureDeliveryProof(order.id)}
                      />
                      {deliveryProofDrafts[order.id] ? (
                        <Image
                          accessibilityLabel="Selected delivery proof"
                          source={{ uri: deliveryProofDrafts[order.id].uri }}
                          style={styles.deliveryProofImage}
                        />
                      ) : (
                        <Text style={styles.deliveryHint}>Add a clear photo at the buyer’s address before completing delivery.</Text>
                      )}
                      <Pressable
                        disabled={!deliveryProofDrafts[order.id] || submittingDeliveryProofId === order.id}
                        onPress={() => { void finishDeliveryOrder(order.id); }}
                        style={[styles.deliveryPrimaryButton, (!deliveryProofDrafts[order.id] || submittingDeliveryProofId === order.id) && styles.disabledButton]}
                      >
                        <View style={styles.deliveryPrimaryButtonContent}>
                          <Ionicons color="#FFF" name="checkmark-circle-outline" size={18} />
                          <Text style={styles.deliveryPrimaryButtonText}>
                            {submittingDeliveryProofId === order.id ? 'Uploading photo…' : 'Mark delivered'}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  )}
                  <Text style={styles.deliveryHint}>
                    {isReady ? 'After collection, status becomes in transit. Mark delivered at the destination.' : 'When you arrive, mark the order delivered to complete the handoff.'}
                  </Text>
                </View>
              );
            })}
            <Text style={[styles.deliverySectionTitle, styles.deliveryCompletedHeading]}>Completed today</Text>
            {completedDeliveryOrders.length === 0 ? (
              <Text style={styles.deliveryInfoBody}>No deliveries completed today.</Text>
            ) : completedDeliveryOrders.map((order) => (
              <View key={order.id} style={styles.deliveryCompletedCard}>
                <View style={styles.deliveryOrderTop}>
                  <Text style={styles.deliveryOrderId}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
                  <View style={styles.deliveryStatusPill}><Text style={styles.deliveryStatusPillText}>Delivered</Text></View>
                </View>
                <View style={styles.deliveryRoute}><Text style={styles.deliveryInfoBody}>{order.pickupDetails.split(' · ')[0]}</Text><Ionicons color="#536A86" name="arrow-forward" size={15} /><Text style={styles.deliveryInfoBody}>{order.buyerName}</Text></View>
                <Text style={styles.deliveryInfoBody}>{order.deliveryAddress} · Delivered at {new Date(order.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                <View style={styles.remittancePanel}>
                  {order.paymentMethod === 'monnify' ? (
                    <Text style={styles.remittanceStatus}>
                      {order.paymentSimulated ? 'Test payment; no cash is due from the buyer.' : 'Paid online; no cash remittance is due.'}
                    </Text>
                  ) : order.paymentMethod !== 'cash_on_delivery' ? (
                    <Text style={styles.remittanceStatus}>Payment method unavailable. Do not collect or remit cash until GetBuy confirms the payment type.</Text>
                  ) : (
                    <>
                      <Text style={styles.remittanceTitle}>Cash remittance · {formatCurrency(order.total)}</Text>
                      {riderRemittances[order.id]?.status === 'confirmed' ? (
                        <Text style={styles.remittanceStatus}>Transfer confirmed. Rider payout of ₦1,500 is queued for admin payment.</Text>
                      ) : riderRemittances[order.id]?.status === 'pending' ? (
                        <Text style={styles.remittanceStatus}>Transfer reference {riderRemittances[order.id].transfer_reference} is awaiting admin confirmation.</Text>
                      ) : (
                        <>
                          {collectionAccount ? (
                            <Text style={styles.remittanceHint}>Transfer the full cash collected to {collectionAccount.bank_name}, {collectionAccount.account_name} · {collectionAccount.account_number}.</Text>
                          ) : (
                            <Text style={styles.remittanceHint}>GetBuy’s collection account has not been configured. Contact marketplace support before transferring the cash.</Text>
                          )}
                          <Field
                            label="Bank transfer reference"
                            value={remittanceReferences[order.id] || ''}
                            onChangeText={(value) => setRemittanceReferences((current) => ({ ...current, [order.id]: value }))}
                            placeholder="Transfer reference"
                          />
                          <Pressable disabled={submittingRemittanceId === order.id || !collectionAccount || !(remittanceReferences[order.id] || '').trim()} onPress={() => { void submitCodRemittance(order.id); }} style={[styles.deliveryRemitButton, (!collectionAccount || !(remittanceReferences[order.id] || '').trim()) && styles.disabledButton]}>
                            <Text style={styles.deliveryPrimaryButtonText}>{submittingRemittanceId === order.id ? 'Submitting…' : 'Submit remittance reference'}</Text>
                          </Pressable>
                        </>
                      )}
                    </>
                  )}
                </View>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={styles.deliverySectionTitle}>Completed today</Text>
            {completedDeliveryOrders.length === 0 ? (
              <View style={styles.deliveryEmptyCard}>
                <Text style={styles.deliveryEmptyTitle}>No completed deliveries yet</Text>
                <Text style={styles.deliveryEmptyText}>Completed assignments will be listed here.</Text>
              </View>
            ) : completedDeliveryOrders.map((order) => (
              <View key={order.id} style={styles.deliveryCompletedCard}>
                <View style={styles.deliveryOrderTop}>
                  <Text style={styles.deliveryOrderId}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
                  <View style={styles.deliveryStatusPill}><Text style={styles.deliveryStatusPillText}>Delivered</Text></View>
                </View>
                <View style={styles.deliveryRoute}><Text style={styles.deliveryInfoBody}>{order.pickupDetails.split(' · ')[0]}</Text><Ionicons color="#536A86" name="arrow-forward" size={15} /><Text style={styles.deliveryInfoBody}>{order.buyerName}</Text></View>
                <Text style={styles.deliveryInfoBody}>{order.deliveryAddress} · Delivered at {new Date(order.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                <View style={styles.remittancePanel}>
                  {order.paymentMethod === 'monnify' ? (
                    <Text style={styles.remittanceStatus}>
                      {order.paymentSimulated ? 'Test payment; no cash is due from the buyer.' : 'Paid online; no cash remittance is due.'}
                    </Text>
                  ) : order.paymentMethod !== 'cash_on_delivery' ? (
                    <Text style={styles.remittanceStatus}>Payment method unavailable. Do not collect or remit cash until GetBuy confirms the payment type.</Text>
                  ) : (
                    <>
                      <Text style={styles.remittanceTitle}>Cash remittance · {formatCurrency(order.total)}</Text>
                      {riderRemittances[order.id]?.status === 'confirmed' ? (
                        <Text style={styles.remittanceStatus}>Transfer confirmed. Rider payout of ₦1,500 is queued for admin payment.</Text>
                      ) : riderRemittances[order.id]?.status === 'pending' ? (
                        <Text style={styles.remittanceStatus}>Transfer reference {riderRemittances[order.id].transfer_reference} is awaiting admin confirmation.</Text>
                      ) : (
                        <>
                          {collectionAccount ? (
                            <Text style={styles.remittanceHint}>Transfer the full cash collected to {collectionAccount.bank_name}, {collectionAccount.account_name} · {collectionAccount.account_number}.</Text>
                          ) : (
                            <Text style={styles.remittanceHint}>GetBuy’s collection account has not been configured. Contact marketplace support before transferring the cash.</Text>
                          )}
                          <Field
                            label="Bank transfer reference"
                            value={remittanceReferences[order.id] || ''}
                            onChangeText={(value) => setRemittanceReferences((current) => ({ ...current, [order.id]: value }))}
                            placeholder="Transfer reference"
                          />
                          <Pressable disabled={submittingRemittanceId === order.id || !collectionAccount || !(remittanceReferences[order.id] || '').trim()} onPress={() => { void submitCodRemittance(order.id); }} style={[styles.deliveryRemitButton, (!collectionAccount || !(remittanceReferences[order.id] || '').trim()) && styles.disabledButton]}>
                            <Text style={styles.deliveryPrimaryButtonText}>{submittingRemittanceId === order.id ? 'Submitting…' : 'Submit remittance reference'}</Text>
                          </Pressable>
                        </>
                      )}
                    </>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
        {deliveryTab === 'completed' ? (
          <>
            <Text style={[styles.deliverySectionTitle, styles.deliveryCompletedHeading]}>Delivery history</Text>
            {riderHistory.length === 0 ? (
              <Text style={styles.deliveryInfoBody}>No previous deliveries to show.</Text>
            ) : riderHistory.map((item) => (
              <View key={item.order_id} style={styles.deliveryCompletedCard}>
                <View style={styles.deliveryOrderTop}>
                  <Text style={styles.deliveryOrderId}>Order #{item.order_id.slice(0, 8).toUpperCase()}</Text>
                  <AdminStatusPill label={item.status} />
                </View>
                <Text style={styles.deliveryInfoBody}>{item.delivery_date} · {getDeliveryWindowLabel(item.delivery_slot)}</Text>
                <Text style={styles.deliveryInfoBody}>Rider payout · {formatCurrency(Number(item.rider_payout))} · {item.remittance_status.replace('_', ' ')}</Text>
                {item.buyer_confirmed_at ? <Text style={styles.remittanceStatus}>Buyer confirmed receipt.</Text> : null}
              </View>
            ))}
          </>
        ) : null}
        {dashboardNotice ? <Text style={styles.dashboardNotice}>{dashboardNotice}</Text> : null}
      </Shell>
    );
  }

  if (screen === 'adminDashboard') {
    const snapshot = adminSnapshot;
    const query = adminSearch.trim().toLowerCase();
    const filteredOrders = (snapshot?.orders || []).filter((order) =>
      `${order.id} ${order.status} ${order.buyer_name} ${order.delivery_address}`.toLowerCase().includes(query),
    );
    const filteredStores = (snapshot?.stores || []).filter((store) =>
      `${store.name} ${store.category} ${store.market_area} ${store.owner_name} ${store.verification_status}`.toLowerCase().includes(query),
    );
    const filteredProducts = (snapshot?.products || []).filter((product) =>
      `${product.name} ${product.category} ${product.store_name}`.toLowerCase().includes(query),
    );
    const filteredUsers = (snapshot?.users || []).filter((user) =>
      `${user.full_name} ${user.role} ${user.area}`.toLowerCase().includes(query),
    );
    const filteredIssues = adminIssues.filter((issue) =>
      `${issue.order_id} ${issue.buyer_id} ${issue.issue_type} ${issue.description} ${issue.status}`.toLowerCase().includes(query),
    );
    const adminTabs: Array<{ id: typeof adminTab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = [
      { id: 'overview', label: 'Overview', icon: 'grid-outline' },
      { id: 'orders', label: 'Orders', icon: 'receipt-outline' },
      { id: 'stores', label: 'Stores', icon: 'storefront-outline' },
      { id: 'products', label: 'Products', icon: 'pricetag-outline' },
      { id: 'people', label: 'People & riders', icon: 'people-outline' },
      { id: 'issues', label: 'Support & refunds', icon: 'alert-circle-outline' },
    ];

    return (
      <Shell>
        <View style={styles.adminPanel}>
        <View style={styles.adminHeader}>
          <View style={styles.adminHeaderCopy}>
            <Text style={styles.adminEyebrow}>GETBUY OPERATIONS</Text>
            <Text style={styles.adminTitle}>Admin panel</Text>
            <Text style={styles.adminSubtitle}>Monitor orders, sellers, products and delivery partners.</Text>
          </View>
          <View style={styles.adminHeaderActions}>
            <Pressable
              accessibilityLabel="Refresh admin dashboard"
              accessibilityRole="button"
              disabled={isLoadingAdminSnapshot}
              onPress={() => setAdminRefreshKey((key) => key + 1)}
              style={styles.adminIconButton}
            >
              <Ionicons color="#143A73" name="refresh-outline" size={20} />
            </Pressable>
            <Pressable onPress={handleSignOut} style={styles.adminSignOutButton}>
              <Ionicons color="#9C3D3D" name="log-out-outline" size={18} />
              <Text style={styles.adminSignOutText}>Sign out</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.adminTabBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminTabScroll}>
            {adminTabs.map((tab) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: adminTab === tab.id }}
                key={tab.id}
                onPress={() => { setAdminTab(tab.id); setAdminSearch(''); }}
                style={[styles.adminTab, adminTab === tab.id && styles.adminTabActive]}
              >
                <Ionicons color={adminTab === tab.id ? '#FFF' : '#536A86'} name={tab.icon} size={17} />
                <Text style={[styles.adminTabText, adminTab === tab.id && styles.adminTabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {adminTab !== 'overview' ? (
          <View style={styles.adminSearchBox}>
            <Ionicons color="#536A86" name="search-outline" size={19} />
            <TextInput
              accessibilityLabel={`Search ${adminTab}`}
              onChangeText={setAdminSearch}
              placeholder={`Search ${adminTab === 'people' ? 'people and riders' : adminTab}...`}
              placeholderTextColor="#7D91A8"
              style={styles.adminSearchInput}
              value={adminSearch}
            />
            {adminSearch ? <Pressable accessibilityLabel="Clear search" onPress={() => setAdminSearch('')}><Ionicons color="#536A86" name="close-circle" size={19} /></Pressable> : null}
          </View>
        ) : null}

        {isLoadingAdminSnapshot && !snapshot ? <Text style={styles.adminLoading}>Loading marketplace data…</Text> : null}
        {!isSupabaseConfigured ? <Text style={styles.authError}>Connect Supabase to load admin data.</Text> : null}

        {adminTab === 'overview' && snapshot ? (
          <>
            <View style={styles.adminMetricGrid}>
              <View style={styles.adminMetricCard}><Text style={styles.adminMetricLabel}>Live orders</Text><Text style={styles.adminMetricValue}>{snapshot.metrics.live_orders}</Text><Ionicons color="#1D4E89" name="receipt-outline" size={20} /></View>
              <View style={styles.adminMetricCard}><Text style={styles.adminMetricLabel}>Stores</Text><Text style={styles.adminMetricValue}>{snapshot.metrics.stores}</Text><Ionicons color="#1D4E89" name="storefront-outline" size={20} /></View>
              <View style={styles.adminMetricCard}><Text style={styles.adminMetricLabel}>Buyers</Text><Text style={styles.adminMetricValue}>{snapshot.metrics.buyers}</Text><Ionicons color="#1D4E89" name="people-outline" size={20} /></View>
              <View style={styles.adminMetricCard}><Text style={styles.adminMetricLabel}>Riders online</Text><Text style={styles.adminMetricValue}>{snapshot.metrics.available_riders}</Text><Ionicons color="#1D4E89" name="bicycle-outline" size={20} /></View>
            </View>
            <Pressable onPress={() => setAdminTab('stores')} style={styles.adminAttentionCard}>
              <View style={styles.adminAttentionIcon}><Ionicons color="#A44A13" name="shield-checkmark-outline" size={21} /></View>
              <View style={styles.adminAttentionCopy}>
                <Text style={styles.adminAttentionTitle}>Store verification</Text>
                <Text style={styles.adminAttentionSubtitle}>{snapshot.metrics.pending_verification} request{snapshot.metrics.pending_verification === 1 ? '' : 's'} awaiting review</Text>
                <Text style={styles.adminAttentionSubtitle}>{snapshot.metrics.pending_rider_verification} rider request{snapshot.metrics.pending_rider_verification === 1 ? '' : 's'} awaiting review</Text>
              </View>
              <Ionicons color="#536A86" name="chevron-forward" size={20} />
            </Pressable>
            <View style={styles.adminSectionHeading}>
              <Text style={styles.adminSectionTitle}>Recent orders</Text>
              <Pressable accessibilityRole="button" onPress={() => setAdminTab('orders')}><Text style={styles.adminSeeAll}>View all</Text></Pressable>
            </View>
            {snapshot.orders.slice(0, 5).map((order) => (
              <View key={order.id} style={styles.adminListCard}>
                <View style={styles.adminListMain}>
                  <Text style={styles.adminListTitle}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={styles.adminListSub}>{order.buyer_name} · {order.item_count} item{order.item_count === 1 ? '' : 's'}</Text>
                </View>
                <View style={styles.adminListEnd}>
                  <Text style={styles.adminListAmount}>{formatCurrency(Number(order.total))}</Text>
                  <AdminStatusPill label={order.status.replaceAll('_', ' ')} />
                </View>
              </View>
            ))}
            {snapshot.orders.length === 0 ? <Text style={styles.adminEmpty}>No orders have been placed yet.</Text> : null}
          </>
        ) : null}

        {adminTab === 'orders' ? (
          <>
            <View style={styles.adminSectionHeading}><Text style={styles.adminSectionTitle}>Orders</Text><Text style={styles.adminCount}>{filteredOrders.length} shown · latest 100</Text></View>
            {filteredOrders.map((order) => (
              <View key={order.id} style={styles.adminListCard}>
                <View style={styles.adminListMain}>
                  <Text style={styles.adminListTitle}>#{order.id.slice(0, 8).toUpperCase()} · {order.buyer_name}</Text>
                  <Text style={styles.adminListSub}>{order.item_count} item{order.item_count === 1 ? '' : 's'} · {order.payment_method.replaceAll('_', ' ')} · Rider: {order.rider_name}</Text>
                  <Text style={styles.adminListSub} numberOfLines={2}>{order.delivery_address}</Text>
                  <Text style={styles.adminListDate}>{new Date(order.created_at).toLocaleString()}</Text>
                </View>
                <View style={styles.adminListEnd}>
                  <Text style={styles.adminListAmount}>{formatCurrency(Number(order.total))}</Text>
                  <AdminStatusPill label={order.status.replaceAll('_', ' ')} />
                </View>
              </View>
            ))}
            {filteredOrders.length === 0 ? <Text style={styles.adminEmpty}>No matching orders.</Text> : null}
          </>
        ) : null}

        {adminTab === 'stores' ? (
          <>
            <View style={styles.adminSectionHeading}><Text style={styles.adminSectionTitle}>Stores & verification</Text><Text style={styles.adminCount}>{filteredStores.length} shown</Text></View>
            {verificationRequests.length > 0 ? <Text style={styles.adminHelper}>Review store information and contact each seller before approving their verified badge.</Text> : null}
            {verificationRequests.filter((request) => `${request.store_name} ${request.category} ${request.market_area} ${request.owner_name}`.toLowerCase().includes(query)).map((request) => (
              <View key={request.store_id} style={styles.verificationRequestCard}>
                <View style={styles.adminVerificationHeader}>
                  <Text style={styles.verificationStoreName}>{request.store_name}</Text>
                  <AdminStatusPill label="pending review" />
                </View>
                <Text style={styles.verificationRequestText}>{request.category} · {request.market_area}</Text>
                <Text style={styles.verificationRequestText}>Pickup: {request.pickup_details}</Text>
                {request.description ? <Text style={styles.verificationRequestText}>{request.description}</Text> : null}
                <View style={styles.verificationDocumentRow}>
                  {request.storefront_photo_url ? <Image accessibilityLabel="Storefront or stall photo" source={{ uri: request.storefront_photo_url }} style={styles.verificationDocumentImage} /> : null}
                  {request.seller_id_url ? <Image accessibilityLabel="Seller identity photo" source={{ uri: request.seller_id_url }} style={styles.verificationDocumentImage} /> : null}
                </View>
                {!request.storefront_photo_url || !request.seller_id_url ? <Text style={styles.adminMissingDocuments}>Required photos are missing. Ask the seller to submit a new request before approving.</Text> : null}
                <Text style={styles.verificationRequestOwner}>{request.owner_name || 'Store owner'}</Text>
                {request.owner_email ? (
                  <Pressable accessibilityRole="button" onPress={() => contactStoreOwner(request.owner_email)} style={styles.verificationContact}>
                    <Text style={styles.verificationContactText}>{request.owner_email}</Text>
                  </Pressable>
                ) : <Text style={styles.adminListSub}>No seller email is available.</Text>}
                <View style={styles.verificationActions}>
                  <Pressable accessibilityRole="button" disabled={isReviewingVerification === request.store_id || !request.storefront_photo_url || !request.seller_id_url} onPress={() => reviewStoreVerification(request.store_id, true)} style={styles.verificationApproveButton}>
                    <Text style={styles.verificationApproveText}>{isReviewingVerification === request.store_id ? 'Saving…' : 'Approve'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={isReviewingVerification === request.store_id} onPress={() => reviewStoreVerification(request.store_id, false)} style={styles.verificationRejectButton}>
                    <Text style={styles.verificationRejectText}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            <Text style={styles.adminSubheading}>All stores</Text>
            {filteredStores.map((store) => (
              <View key={store.id} style={styles.adminListCard}>
                <View style={styles.adminListMain}>
                  <Text style={styles.adminListTitle}>{store.name}</Text>
                  <Text style={styles.adminListSub}>{store.category} · {store.market_area || 'Area not provided'}</Text>
                  <Text style={styles.adminListSub}>Owner: {store.owner_name} · {store.product_count} products</Text>
                </View>
                <AdminStatusPill label={store.verification_status} />
              </View>
            ))}
            {filteredStores.length === 0 && verificationRequests.length === 0 ? <Text style={styles.adminEmpty}>No stores match this search.</Text> : null}
          </>
        ) : null}

        {adminTab === 'products' ? (
          <>
            <View style={styles.adminSectionHeading}><Text style={styles.adminSectionTitle}>Product catalog</Text><Text style={styles.adminCount}>{filteredProducts.length} shown · latest 100</Text></View>
            <Text style={styles.adminHelper}>Hide inappropriate listings or restore products when they meet marketplace standards.</Text>
            {filteredProducts.map((product) => (
              <View key={product.id} style={styles.adminListCard}>
                <View style={styles.adminListMain}>
                  <Text style={styles.adminListTitle}>{product.name}</Text>
                  <Text style={styles.adminListSub}>{product.store_name} · {product.category}</Text>
                  <Text style={styles.adminListSub}>{formatCurrency(Number(product.price))} / {product.unit} · {product.stock_quantity} in stock</Text>
                </View>
                <View style={styles.adminListEnd}>
                  <AdminStatusPill label={product.is_available ? 'listed' : 'hidden'} />
                  <Pressable
                    accessibilityRole="button"
                    disabled={adminProductBusyId === product.id || (!product.is_available && Number(product.stock_quantity) <= 0)}
                    onPress={() => setAdminProductAvailability(product)}
                    style={styles.adminProductAction}
                  >
                    <Text style={styles.adminProductActionText}>{adminProductBusyId === product.id ? 'Saving…' : product.is_available ? 'Hide' : 'Restore'}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {filteredProducts.length === 0 ? <Text style={styles.adminEmpty}>No products match this search.</Text> : null}
          </>
        ) : null}

        {adminTab === 'issues' ? (
          <>
            <View style={styles.adminSectionHeading}>
              <Text style={styles.adminSectionTitle}>Cancellation requests</Text>
              <Text style={styles.adminCount}>{adminCancellationRequests.filter((request) => request.status === 'pending').length} awaiting review</Text>
            </View>
            {adminCancellationRequests.filter((request) => request.status === 'pending').map((request) => (
              <View key={request.id} style={styles.adminListCard}>
                <View style={styles.adminIssueContent}>
                  <View style={styles.adminVerificationHeader}>
                    <Text style={styles.adminListTitle}>Order #{request.order_id.slice(0, 8).toUpperCase()}</Text>
                    <AdminStatusPill label={request.status} />
                  </View>
                  <Text style={styles.adminListSub}>Buyer {request.buyer_id.slice(0, 8)} · {new Date(request.created_at).toLocaleDateString()}</Text>
                  <Text style={styles.adminListSub}>{request.reason}</Text>
                  <Field
                    label="Admin note (optional)"
                    value={adminCancellationNotes[request.id] ?? ''}
                    onChangeText={(value) => setAdminCancellationNotes((current) => ({ ...current, [request.id]: value }))}
                    placeholder="Explain your decision"
                    multiline
                  />
                  <View style={styles.adminIssueActions}>
                    <SecondaryButton label="Decline" onPress={() => void reviewOrderCancellation(request, false)} />
                    <PrimaryButton label="Approve & cancel" onPress={() => void reviewOrderCancellation(request, true)} />
                  </View>
                </View>
              </View>
            ))}
            {adminCancellationRequests.every((request) => request.status !== 'pending') ? <Text style={styles.adminEmpty}>No cancellation requests need review.</Text> : null}
            <View style={styles.adminSectionHeading}>
              <Text style={styles.adminSectionTitle}>Manual refunds</Text>
              <Text style={styles.adminCount}>{adminRefundRequests.filter((refund) => ['pending_manual', 'processing'].includes(refund.status)).length} open</Text>
            </View>
            {adminRefundRequests.filter((refund) => ['pending_manual', 'processing'].includes(refund.status)).map((refund) => {
              const draft = adminRefundDrafts[refund.id] || {
                status: refund.status === 'pending_manual' ? 'processing' : refund.status,
                reference: refund.provider_reference || '',
                note: refund.admin_note || '',
              };
              return (
                <View key={refund.id} style={styles.adminListCard}>
                  <View style={styles.adminIssueContent}>
                    <View style={styles.adminVerificationHeader}>
                      <Text style={styles.adminListTitle}>Order #{refund.order_id.slice(0, 8).toUpperCase()}</Text>
                      <AdminStatusPill label={refund.status.replaceAll('_', ' ')} />
                    </View>
                    <Text style={styles.adminListSub}>Buyer {refund.buyer_id.slice(0, 8)} · {formatCurrency(Number(refund.amount))}</Text>
                    <Text style={styles.adminHelper}>Process the refund through the payment provider before recording it here.</Text>
                    <Field label="Transfer reference (required when refunded)" value={draft.reference} onChangeText={(value) => setAdminRefundDrafts((current) => ({ ...current, [refund.id]: { ...draft, reference: value } }))} placeholder="Provider or bank reference" />
                    <Field label="Note for buyer" value={draft.note} onChangeText={(value) => setAdminRefundDrafts((current) => ({ ...current, [refund.id]: { ...draft, note: value } }))} placeholder="Add a status update" multiline />
                    <View style={styles.adminIssueActions}>
                      {(['processing', 'refunded', 'rejected'] as const).map((status) => (
                        <Pressable
                          accessibilityRole="button"
                          key={status}
                          onPress={() => setAdminRefundDrafts((current) => ({ ...current, [refund.id]: { ...draft, status } }))}
                          style={[styles.issueTypeChoice, draft.status === status && styles.issueTypeChoiceSelected]}
                        >
                          <Text style={[styles.issueTypeChoiceText, draft.status === status && styles.issueTypeChoiceTextSelected]}>{status}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <PrimaryButton label="Save refund update" onPress={() => void updateOrderRefund(refund)} />
                  </View>
                </View>
              );
            })}
            {adminRefundRequests.every((refund) => !['pending_manual', 'processing'].includes(refund.status)) ? <Text style={styles.adminEmpty}>No manual refunds need an update.</Text> : null}
            <View style={styles.adminSectionHeading}>
              <Text style={styles.adminSectionTitle}>Buyer issue reports</Text>
              <Text style={styles.adminCount}>{filteredIssues.length} shown · latest 100</Text>
            </View>
            {filteredIssues.map((issue) => (
              <View key={issue.id} style={styles.adminListCard}>
                <View style={styles.adminIssueContent}>
                  <View style={styles.adminVerificationHeader}>
                    <Text style={styles.adminListTitle}>Order #{issue.order_id.slice(0, 8).toUpperCase()}</Text>
                    <AdminStatusPill label={issue.status.replaceAll('_', ' ')} />
                  </View>
                  <Text style={styles.adminListSub}>{issue.issue_type.replaceAll('_', ' ')} · Buyer {issue.buyer_id.slice(0, 8)}</Text>
                  <Text style={styles.adminListSub}>{issue.description}</Text>
                  <Field
                    label="Response for buyer (optional)"
                    value={adminIssueNotes[issue.id] ?? issue.admin_note}
                    onChangeText={(value) => setAdminIssueNotes((current) => ({ ...current, [issue.id]: value }))}
                    placeholder="Add an update for the buyer"
                    multiline
                  />
                  <View style={styles.adminIssueActions}>
                    {(['open', 'in_review', 'resolved'] as const).map((status) => (
                      <Pressable
                        accessibilityRole="button"
                        key={status}
                        onPress={() => void updateAdminIssue(issue, status)}
                        style={[styles.issueTypeChoice, issue.status === status && styles.issueTypeChoiceSelected]}
                      >
                        <Text style={[styles.issueTypeChoiceText, issue.status === status && styles.issueTypeChoiceTextSelected]}>
                          {status.replaceAll('_', ' ')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            ))}
            {filteredIssues.length === 0 ? <Text style={styles.adminEmpty}>No issue reports match this search.</Text> : null}
          </>
        ) : null}

        {adminTab === 'people' && snapshot ? (
          <>
            <View style={styles.adminSectionHeading}><Text style={styles.adminSectionTitle}>Rider verification</Text><Text style={styles.adminCount}>{riderVerificationRequests.length} awaiting review</Text></View>
            <Text style={styles.adminHelper}>Check the plate against the rider’s licence and current roadworthiness document before approving.</Text>
            {riderVerificationRequests.filter((request) => `${request.rider_name} ${request.rider_email} ${request.plate_number}`.toLowerCase().includes(query)).map((request) => (
              <View key={request.verification_id} style={styles.verificationRequestCard}>
                <View style={styles.adminVerificationHeader}>
                  <Text style={styles.verificationStoreName}>{request.rider_name || 'Delivery partner'}</Text>
                  <AdminStatusPill label="pending review" />
                </View>
                <Text style={styles.verificationRequestText}>Vehicle plate: {request.plate_number}</Text>
                {request.rider_email ? (
                  <Pressable accessibilityRole="button" onPress={() => contactStoreOwner(request.rider_email)} style={styles.verificationContact}>
                    <Text style={styles.verificationContactText}>{request.rider_email}</Text>
                  </Pressable>
                ) : <Text style={styles.adminListSub}>No rider email is available.</Text>}
                <View style={styles.verificationDocumentGrid}>
                  {request.plate_photo_url ? <View style={styles.verificationDocumentCard}><Image accessibilityLabel="Vehicle number plate photo" source={{ uri: request.plate_photo_url }} style={styles.verificationDocumentImageLarge} /><Text style={styles.verificationDocumentLabel}>Number plate</Text></View> : null}
                  {request.roadworthiness_photo_url ? <View style={styles.verificationDocumentCard}><Image accessibilityLabel="Roadworthiness document" source={{ uri: request.roadworthiness_photo_url }} style={styles.verificationDocumentImageLarge} /><Text style={styles.verificationDocumentLabel}>Roadworthiness</Text></View> : null}
                  {request.driver_license_photo_url ? <View style={styles.verificationDocumentCard}><Image accessibilityLabel="Driver licence" source={{ uri: request.driver_license_photo_url }} style={styles.verificationDocumentImageLarge} /><Text style={styles.verificationDocumentLabel}>Driver licence</Text></View> : null}
                </View>
                {!request.plate_photo_url || !request.roadworthiness_photo_url || !request.driver_license_photo_url ? <Text style={styles.adminMissingDocuments}>Required photos are missing. Do not approve this request.</Text> : null}
                <View style={styles.verificationActions}>
                  <Pressable accessibilityRole="button" disabled={isReviewingVerification === request.verification_id || !request.plate_photo_url || !request.roadworthiness_photo_url || !request.driver_license_photo_url} onPress={() => reviewRiderVerification(request, true)} style={styles.verificationApproveButton}>
                    <Text style={styles.verificationApproveText}>{isReviewingVerification === request.verification_id ? 'Saving…' : 'Approve rider'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={isReviewingVerification === request.verification_id} onPress={() => reviewRiderVerification(request, false)} style={styles.verificationRejectButton}>
                    <Text style={styles.verificationRejectText}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {riderVerificationRequests.length === 0 ? <Text style={styles.adminEmpty}>No rider verification requests are waiting.</Text> : null}
            <View style={styles.adminSectionHeading}><Text style={styles.adminSectionTitle}>Delivery partners</Text><Text style={styles.adminCount}>{snapshot.delivery_partners.length} listed</Text></View>
            {snapshot.delivery_partners.map((rider) => (
              <View key={rider.id} style={styles.adminListCard}>
                <View style={styles.adminListMain}>
                  <Text style={styles.adminListTitle}>{rider.full_name}</Text>
                  <Text style={styles.adminListSub}>{rider.vehicle_type || 'Vehicle not provided'}</Text>
                  {rider.plate_number ? <Text style={styles.adminListSub}>Plate: {rider.plate_number}</Text> : null}
                </View>
                <View style={styles.adminListEnd}><AdminStatusPill label={rider.verification_status} /><AdminStatusPill label={rider.is_available ? 'available' : 'offline'} /></View>
              </View>
            ))}
            <View style={styles.adminSectionHeading}><Text style={styles.adminSectionTitle}>Accounts</Text><Text style={styles.adminCount}>{filteredUsers.length} shown · latest 100</Text></View>
            {filteredUsers.map((user) => (
              <View key={user.id} style={styles.adminListCard}>
                <View style={styles.adminListMain}>
                  <Text style={styles.adminListTitle}>{user.full_name || 'Unnamed account'}</Text>
                  <Text style={styles.adminListSub}>{user.area || 'Area not provided'} · joined {new Date(user.created_at).toLocaleDateString()}</Text>
                </View>
                <AdminStatusPill label={user.role} />
              </View>
            ))}
            {filteredUsers.length === 0 ? <Text style={styles.adminEmpty}>No accounts match this search.</Text> : null}
          </>
        ) : null}

        {isLoadingAdminSnapshot && snapshot ? <Text style={styles.adminLoading}>Refreshing marketplace data…</Text> : null}
        {dashboardNotice ? <Text style={styles.dashboardNotice}>{dashboardNotice}</Text> : null}
        </View>
      </Shell>
    );
  }

  if (screen === 'auth') {
    const roleLabel = role === 'buyer' ? 'Buyer' : role === 'seller' ? 'Seller' : role === 'delivery' ? 'Delivery partner' : 'Administrator';
    const roleIcon = role === 'buyer' ? 'basket-outline' : role === 'seller' ? 'storefront-outline' : role === 'delivery' ? 'bicycle-outline' : 'grid-outline';
    const roleDescription = role === 'buyer'
      ? 'Discover fresh finds from growers and shops right in your neighbourhood.'
      : role === 'seller'
        ? 'Bring your local store online, share your products, and manage orders in one place.'
        : role === 'delivery'
          ? 'Pick up local orders and get them to nearby customers on your schedule.'
          : 'Oversee marketplace activity and support your local team.';
    return (
      <Shell>
        <View style={styles.authWelcomeTopBar}>
          <BackButton onPress={goBack} />
          <LogoLockup green compact />
        </View>
        <View style={styles.authWelcomeHero}>
          <View style={styles.authWelcomeOrb} />
          <View style={styles.authWelcomeOrbSmall} />
          <Text style={styles.authWelcomeEyebrow}>YOUR LOCAL MARKETPLACE</Text>
          <View style={styles.authWelcomeIcon}><Ionicons color="#143A73" name={roleIcon} size={29} /></View>
          <Text style={styles.authWelcomeTitle}>{role === 'admin' ? 'Welcome back' : 'Welcome to getBuy'}</Text>
          <Text style={styles.authWelcomeRole}>{roleLabel} access</Text>
          <Text style={styles.authWelcomeDescription}>{roleDescription}</Text>
          <View style={styles.authWelcomePerk}>
            <Ionicons color="#BFE6D0" name="checkmark-circle" size={17} />
            <Text style={styles.authWelcomePerkText}>
              {role === 'buyer' ? 'Fresh picks from sellers near you' : role === 'seller' ? 'Your store, orders, and listings together' : role === 'delivery' ? 'Local deliveries, clearly organized' : 'A dedicated operations workspace'}
            </Text>
          </View>
        </View>
        {role === 'admin' ? (
          <>
            <Text style={styles.authWelcomeAdminNote}>Administrator access is invitation-only. Sign in with the account provisioned for you.</Text>
            <Pressable accessibilityRole="button" onPress={() => setScreen('signin')} style={({ pressed }) => [styles.authWelcomePrimaryButton, pressed && styles.pressedButton]}>
              <Text style={styles.authWelcomePrimaryText}>Sign in to operations</Text>
              <Ionicons color="#D5F0FF" name="arrow-forward" size={22} style={styles.authWelcomeArrow} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => setScreen('create')} style={({ pressed }) => [styles.authWelcomePrimaryButton, pressed && styles.pressedButton]}>
              <Text style={styles.authWelcomePrimaryText}>Create {role === 'buyer' ? 'buyer' : role === 'seller' ? 'seller' : 'delivery'} account</Text>
              <Ionicons color="#D5F0FF" name="arrow-forward" size={22} style={styles.authWelcomeArrow} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setScreen('signin')} style={({ pressed }) => [styles.authWelcomeSecondaryButton, pressed && styles.pressedButton]}>
              <Text style={styles.authWelcomeSecondaryText}>I already have an account</Text>
            </Pressable>
          </>
        )}
        {role !== 'admin' ? <Terms onOpen={() => openTerms('auth')} /> : null}
      </Shell>
    );
  }

  if (screen === 'create') {
    if (role === 'admin') {
      return (
        <FormShell title="" description="" onBack={goBack} hideHeader>
          <View style={styles.accountHeaderRow}>
            <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
            <View style={styles.accountBrand}><LogoLockup green /></View>
          </View>
          <Text style={styles.accountEyebrow}>ADMINISTRATOR · INVITATION ONLY</Text>
          <Text style={styles.accountTitle}>Admin access is by invitation</Text>
          <Text style={styles.accountDescription}>Use the email and password provided by your marketplace administrator to sign in.</Text>
          <PrimaryButton label="Sign in to operations" onPress={() => setScreen('signin')} />
        </FormShell>
      );
    }
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountEyebrow}>{role === 'buyer' ? 'BUYER ACCOUNT · CHANGE ROLE' : role === 'seller' ? 'ACCOUNT · SELLER' : role === 'delivery' ? 'ACCOUNT · DELIVERY' : 'ACCOUNT · ADMIN'}</Text>
        <Text style={styles.accountTitle}>Join your local market</Text>
        <Text style={styles.accountDescription}>Just the essentials to get started. Your location comes next.</Text>
        <Field label="Full name" value={name} onChangeText={setName} placeholder="Your full name" />
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="maya@example.com" keyboardType="email-address" />
        <Field
          label="Phone number"
          value={signupPhone}
          onChangeText={setSignupPhone}
          placeholder="+234 801 234 5678"
          keyboardType="phone-pad"
        />
        <Text style={styles.formHint}>We’ll use this number for order and account contact. Email verification is required to activate your account.</Text>
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••••" secureTextEntry={!showPassword} />
        <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.showPassword}>
          <Ionicons color="#143A73" name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={19} style={styles.showPasswordIcon} />
          <Text style={styles.showPasswordText}>{showPassword ? 'Hide password' : 'Show password'}</Text>
        </Pressable>
        <Field label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter your password" secureTextEntry={!showConfirmPassword} />
        <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.showPassword}>
          <Ionicons color="#143A73" name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={19} style={styles.showPasswordIcon} />
          <Text style={styles.showPasswordText}>{showConfirmPassword ? 'Hide confirmation' : 'Show confirmation'}</Text>
        </Pressable>
        {confirmPassword && password !== confirmPassword ? <Text style={styles.authError}>Passwords do not match.</Text> : null}
        <Text style={styles.formHint}>Use at least 8 characters. You can reveal it to check.</Text>
        <Text style={styles.accountTerms}>
          Your account is used to manage your orders and account details.{' '}
          <Text onPress={() => openTerms('create')} style={styles.termsLink}>Read the Terms and Conditions</Text>.
        </Text>
        <PrimaryButton
          label={isSubmittingAuth ? 'Creating account...' : role === 'buyer' ? 'Create buyer account' : 'Create account'}
          disabled={isSubmittingAuth || !name.trim() || password.length < 8 || !email.trim() || signupPhone.replace(/\D/g, '').length < 10 || !confirmPassword || password !== confirmPassword}
          onPress={createAccount}
        />
        <View style={styles.authDivider}><View style={styles.authDividerLine} /><Text style={styles.authDividerText}>or sign up with</Text><View style={styles.authDividerLine} /></View>
        <View style={styles.socialButtons}>
          {(['google', 'facebook', 'apple'] as const).map((provider) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Continue with ${provider}`}
              disabled={isSubmittingAuth}
              key={provider}
              onPress={() => signInWithProvider(provider)}
              style={[styles.socialButton, isSubmittingAuth && styles.disabledButton]}
            >
              <Ionicons color="#143A73" name={({ google: 'logo-google', facebook: 'logo-facebook', apple: 'logo-apple' } as const)[provider]} size={18} />
              <Text style={styles.socialButtonLabel}>{provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : 'Facebook'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.socialAuthHint}>Social sign-in is available when the provider is enabled in GetBuy's authentication settings.</Text>
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        <Pressable onPress={() => setScreen('signin')} style={styles.registeredLink}>
          <Text style={styles.registeredLinkText}>Already registered? Sign in</Text>
        </Pressable>
      </FormShell>
    );
  }

  if (screen === 'verifySignup') {
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountTitle}>Verify your email</Text>
        <Text style={styles.accountDescription}>
          Enter the code we sent to {email.trim()} to verify your email and finish creating your account.
        </Text>
        <Text style={styles.fieldLabel}>Email verification code</Text>
        <TextInput
          accessibilityLabel="Email verification code"
          autoComplete="one-time-code"
          keyboardType="number-pad"
          maxLength={8}
          onChangeText={(value) => setSignupCode(value.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••••••"
          placeholderTextColor="#143A73"
          style={styles.recoveryCodeInput}
          textContentType="oneTimeCode"
          value={signupCode}
        />
        <View style={styles.recoveryResendRow}>
          <Text style={styles.recoveryResendText}>Didn’t receive a code?</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmittingAuth}
            onPress={() => void resendSignupCode()}
          >
            <Text style={styles.recoveryResendLink}>{isSubmittingAuth ? 'Sending…' : 'Resend code'}</Text>
          </Pressable>
        </View>
        {signupNotice ? <Text style={styles.dashboardNotice}>{signupNotice}</Text> : null}
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        <PrimaryButton
          label={isSubmittingAuth ? 'Verifying…' : 'Verify email'}
          disabled={isSubmittingAuth || !isValidEmailOtp(signupCode)}
          onPress={() => void verifySignupCode()}
        />
      </FormShell>
    );
  }

  if (screen === 'forgotPassword') {
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountTitle}>Forgot password</Text>
        <Text style={styles.accountDescription}>Please enter your registered email address to receive a verification code.</Text>
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          placeholder="maya@example.com"
          keyboardType="email-address"
        />
        {recoveryError ? <Text style={styles.authError}>{recoveryError}</Text> : null}
        <PrimaryButton
          label={isSubmittingRecovery ? 'Sending code…' : 'Continue'}
          disabled={isSubmittingRecovery || !email.trim()}
          onPress={() => void resetPassword()}
        />
      </FormShell>
    );
  }

  if (screen === 'verifyRecovery') {
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountTitle}>Verification</Text>
        <Text style={styles.accountDescription}>
          We’ve sent a verification code to {email.trim()}. Enter the code below to continue.
        </Text>
        <Text style={styles.fieldLabel}>Enter verification code</Text>
        <TextInput
          accessibilityLabel="Password reset verification code"
          autoComplete="one-time-code"
          keyboardType="number-pad"
          maxLength={8}
          onChangeText={(value) => setRecoveryCode(value.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••••••"
          placeholderTextColor="#143A73"
          style={styles.recoveryCodeInput}
          textContentType="oneTimeCode"
          value={recoveryCode}
        />
        <View style={styles.recoveryResendRow}>
          <Text style={styles.recoveryResendText}>Didn’t receive a code?</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmittingRecovery}
            onPress={() => void resetPassword()}
          >
            <Text style={styles.recoveryResendLink}>Resend code</Text>
          </Pressable>
        </View>
        {recoveryNotice ? <Text style={styles.dashboardNotice}>{recoveryNotice}</Text> : null}
        {recoveryError ? <Text style={styles.authError}>{recoveryError}</Text> : null}
        <PrimaryButton
          label={isSubmittingRecovery ? 'Verifying…' : 'Continue'}
          disabled={isSubmittingRecovery || !isValidEmailOtp(recoveryCode)}
          onPress={() => void verifyRecoveryCode()}
        />
      </FormShell>
    );
  }

  if (screen === 'newPassword') {
    const passwordsMatch = !confirmNewPassword || newPassword === confirmNewPassword;
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountTitle}>Create New Password</Text>
        <Text style={styles.accountDescription}>Enter your new password below.</Text>
        {recoveryNotice ? (
          <View style={styles.recoverySuccessCard}>
            <Ionicons color="#FFF" name="checkmark-circle" size={25} />
            <Text style={styles.recoverySuccessText}>{recoveryNotice}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.fieldLabel}>New Password</Text>
            <View style={styles.recoveryPasswordInputWrap}>
              <TextInput
                accessibilityLabel="New password"
                autoCapitalize="none"
                autoComplete="new-password"
                onChangeText={setNewPassword}
                placeholder="Enter at least 8 characters"
                placeholderTextColor="#8B9DB2"
                secureTextEntry={!showNewPassword}
                style={styles.recoveryPasswordInput}
                textContentType="newPassword"
                value={newPassword}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={showNewPassword ? 'Hide password' : 'Show password'} onPress={() => setShowNewPassword((value) => !value)} style={styles.recoveryPasswordToggle}>
                <Ionicons color="#143A73" name={showNewPassword ? 'eye-off-outline' : 'eye-outline'} size={22} />
              </Pressable>
            </View>
            <Text style={styles.recoveryPasswordHint}>Use at least 8 characters.</Text>
            <Text style={styles.fieldLabel}>Confirm Password</Text>
            <View style={[styles.recoveryPasswordInputWrap, !passwordsMatch && styles.recoveryPasswordInputError]}>
              <TextInput
                accessibilityLabel="Confirm new password"
                autoCapitalize="none"
                autoComplete="new-password"
                onChangeText={setConfirmNewPassword}
                placeholder="Re-enter your new password"
                placeholderTextColor="#8B9DB2"
                secureTextEntry={!showConfirmNewPassword}
                style={styles.recoveryPasswordInput}
                textContentType="newPassword"
                value={confirmNewPassword}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={showConfirmNewPassword ? 'Hide password' : 'Show password'} onPress={() => setShowConfirmNewPassword((value) => !value)} style={styles.recoveryPasswordToggle}>
                <Ionicons color="#143A73" name={showConfirmNewPassword ? 'eye-off-outline' : 'eye-outline'} size={22} />
              </Pressable>
            </View>
            {!passwordsMatch ? <Text style={styles.authError}>Passwords do not match.</Text> : null}
          </>
        )}
        {recoveryError ? <Text style={styles.authError}>{recoveryError}</Text> : null}
        {recoveryNotice ? (
          <PrimaryButton
            label={isSubmittingRecovery ? 'Finishing…' : 'Back to sign in'}
            disabled={isSubmittingRecovery}
            onPress={() => void finishPasswordRecovery()}
          />
        ) : (
          <PrimaryButton
            label={isSubmittingRecovery ? 'Updating password…' : 'Continue'}
            disabled={isSubmittingRecovery || !newPassword || !confirmNewPassword || !passwordsMatch}
            onPress={() => void updateRecoveredPassword()}
          />
        )}
      </FormShell>
    );
  }

  if (screen === 'signin') {
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountEyebrow}>WELCOME BACK</Text>
        <Text style={styles.accountTitle}>{role === 'admin' ? 'Welcome back' : 'Back to fresh.'}</Text>
        <Text style={styles.accountDescription}>{role === 'admin' ? 'Sign in with the administrator account provisioned for you.' : 'Sign in to pick up where you left off.'}</Text>
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="maya@example.com" keyboardType="email-address" />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberLogin }}
          onPress={toggleRememberLogin}
          style={styles.rememberLoginRow}
        >
          <View style={[styles.rememberLoginCheckbox, rememberLogin && styles.rememberLoginCheckboxSelected]}>
            {rememberLogin ? <Ionicons color="#FFF" name="checkmark" size={14} /> : null}
          </View>
          <Text style={styles.rememberLoginLabel}>Remember my email on this device</Text>
        </Pressable>
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••••" secureTextEntry={!showPassword} />
        <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.showPassword}><Text style={styles.showPasswordText}>{showPassword ? 'Hide password' : 'Show password'}</Text></Pressable>
        <Pressable onPress={() => { setRecoveryError(''); setRecoveryNotice(''); setScreen('forgotPassword'); }} hitSlop={8}>
          <Text style={styles.forgotPassword}>Forgot password?</Text>
        </Pressable>
        <PrimaryButton
          label={isSubmittingAuth ? 'Signing in...' : 'Sign in'}
          disabled={isSubmittingAuth || !email.trim() || !password}
          onPress={signIn}
        />
        {biometricEnabled && Platform.OS !== 'web' ? (
          <SecondaryButton
            label={isBiometricBusy ? 'Checking device unlock…' : 'Unlock with Face ID or phone passcode'}
            disabled={isBiometricBusy}
            onPress={unlockWithBiometrics}
          />
        ) : null}
        {role !== 'admin' ? (
          <>
            <View style={styles.authDivider}><View style={styles.authDividerLine} /><Text style={styles.authDividerText}>or continue with</Text><View style={styles.authDividerLine} /></View>
            <View style={styles.socialButtons}>
              {(['google', 'facebook', 'apple'] as const).map((provider) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Continue with ${provider}`}
                  disabled={isSubmittingAuth}
                  key={provider}
                  onPress={() => signInWithProvider(provider)}
                  style={[styles.socialButton, isSubmittingAuth && styles.disabledButton]}
                >
                  <Ionicons color="#143A73" name={({ google: 'logo-google', facebook: 'logo-facebook', apple: 'logo-apple' } as const)[provider]} size={18} />
                  <Text style={styles.socialButtonLabel}>{provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : 'Facebook'}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.socialAuthHint}>Social sign-in is available when the provider is enabled in GetBuy's authentication settings.</Text>
          </>
        ) : null}
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        {role !== 'admin' ? (
          <>
            <Pressable onPress={() => role ? setScreen('create') : setScreen('roleChoice')} style={styles.registeredLink}><Text style={styles.registeredLinkText}>New here? Create an account</Text></Pressable>
            <View style={styles.accountInfoCard}><Text style={styles.accountTerms}>Your account determines the dashboard you see.</Text></View>
          </>
        ) : null}
      </FormShell>
    );
  }

  if (screen === 'location') {
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.accountHeaderRow}>
          <View style={styles.backButtonWrap}><BackButton onPress={goBack} /></View>
          <View style={styles.accountBrand}><LogoLockup green /></View>
        </View>
        <Text style={styles.accountEyebrow}>BUYER · LOCATION</Text>
        <Text style={styles.accountTitle}>Where’s local for you?</Text>
        <Text style={styles.accountDescription}>Choose your neighbourhood so the marketplace can show nearby shops and products. Add your full delivery address too.</Text>
        <Pressable disabled={isGettingCurrentLocation} onPress={useCurrentLocation} style={[styles.currentLocationButton, isGettingCurrentLocation && styles.disabledButton]}>
          <Ionicons color="#143A73" name="navigate-outline" size={21} style={styles.currentLocationIcon} />
          <Text style={styles.currentLocationButtonText}>{isGettingCurrentLocation ? 'Finding your location…' : 'Use my current location'}</Text>
        </Pressable>
        <Text style={styles.locationHintText}>We’ll ask your permission while the app is open. You can edit the address or enter it manually below.</Text>
        <Field label="Address / location details" value={location} onChangeText={setLocation} placeholder="Enter your delivery address" />
        <Field label="Area / neighbourhood" value={area} onChangeText={setArea} placeholder="Your neighbourhood" />
        <Field label="Helpful directions (optional)" value={directions} onChangeText={setDirections} placeholder="Landmarks or delivery instructions" />
        <View style={styles.infoCard}><Text style={styles.infoCardTitle}>Prefer to collect?</Text><Text style={styles.infoCardText}>Collection is agreed with the seller. Adding your location does not commit you to delivery.</Text></View>
        <PrimaryButton label={isSavingLocation ? 'Saving location...' : 'Save location & continue'} disabled={isSavingLocation || !location.trim()} onPress={saveBuyerLocation} />
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
      </FormShell>
    );
  }

  if (screen === 'sellerSetup') {
    return (
      <Shell>
        <BackButton onPress={goBack} />
        <View style={styles.localvegRowHeader}>
          <LogoLockup green />
        </View>
        <Text style={styles.sectionEyebrow}>SELLER · STORE DETAILS</Text>
        <Text style={styles.storeSetupTitle}>{`Meet your local\ncustomers`}</Text>
        <Text style={styles.storeSetupSubtitle}>Give buyers the details they need to recognise your stall or store.</Text>

        <Field label="Store / vendor name" value={storeName} onChangeText={setStoreName} placeholder="Your store name" />
        <Field label="Seller type" value={storeCategory} onChangeText={setStoreCategory} placeholder="Market vendor" />
        <Text style={styles.helperText}>Local farmer, grocery trader or vendor</Text>
        <Field label="Market / trading area" value={storeArea} onChangeText={setStoreArea} placeholder="Your local market" />
        <Text style={styles.helperText}>Include your neighbourhood and city, for example “Kubwa, Abuja”, so nearby buyers can find your shop.</Text>
        <Field label="Stall / pickup location" value={pickupDetails} onChangeText={setPickupDetails} placeholder="Stall number or pickup instructions" />
        <Field label="About your store (optional)" value={storeDescription} onChangeText={setStoreDescription} placeholder="Describe your store and produce" multiline />
        <Text style={styles.noticeText}>These details appear with your products. Collection arrangements are agreed with each buyer.</Text>
        <PrimaryButton label={isSavingStore ? 'Saving store...' : 'Save store & add first product'} disabled={isSavingStore || !storeName.trim() || !storeCategory.trim()} onPress={openSellerStore} />
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
      </Shell>
    );
  }

  if (screen === 'complete') {
    if (role === 'buyer') {
      return (
        <Shell>
          <View style={styles.localvegRowHeader}>
            <LogoLockup green />
          </View>
          <View style={styles.completeBadgeWrap}>
            <View style={styles.completeBadge}><Ionicons color="#1D4E89" name="checkmark-circle" size={45} /></View>
          </View>
          <View style={styles.eyebrowPill}><Text style={styles.eyebrowPillText}>BUYER • ALL SET</Text></View>
          <Text style={styles.completeHeadline}>{`You’re part of the\nneighbourhood.`}</Text>
          <Text style={styles.completeSubtitle}>{`Welcome, ${name || 'neighbour'}. Your buyer account is ready. Let’s see what’s fresh near you.`}</Text>
          <View style={styles.locationSummary}>
            <Ionicons color="#1D4E89" name="location" size={23} style={styles.locationSummaryIcon} />
            <View style={styles.locationSummaryTextWrap}>
              <Text style={styles.locationSummaryValue}>{location || 'No location added'}</Text>
              <Text style={styles.locationSummarySub}>{area || 'Your neighbourhood'} • You can update this from your profile.</Text>
            </View>
          </View>
          <Pressable onPress={() => setScreen('dashboard')} style={styles.primaryDarkButtonLarge}>
            <Text style={styles.primaryDarkButtonText}>Explore the marketplace</Text>
          </Pressable>
          <Text style={styles.inlineGuide}>Browse first. Choose delivery or seller-agreed collection when you order.</Text>
          <View style={styles.progressIndicator} />
        </Shell>
      );
    }

    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.centerContent}>
          <View style={styles.successMark}><Ionicons color="#143A73" name="checkmark-circle" size={48} /></View>
          <Text style={styles.pageTitle}>{role === 'seller' ? 'Your store is open' : 'You’re all set'}</Text>
          <Text style={styles.pageDescription}>
            {role === 'seller'
              ? 'Add your first product listing so buyers can discover your store.'
              : 'Your GetBuy account is ready to use.'}
          </Text>
          <PrimaryButton
            label={role === 'seller' ? 'Go to seller dashboard' : 'Continue'}
            onPress={() => setScreen(role === 'seller' ? 'sellerDashboard' : role === 'delivery' ? 'deliveryDashboard' : role === 'admin' ? 'adminSetup' : 'dashboard')}
          />
        </View>
      </FormShell>
    );
  }

  if (screen === 'deliverySetup') {
    const profilePhotoUrl = profilePhotoPath
      ? `${supabase.storage.from('profile-photos').getPublicUrl(profilePhotoPath).data.publicUrl}?v=${profilePhotoVersion}`
      : null;
    return (
      <FormShell title="" description="" onBack={goBack} hideHeader>
        <View style={styles.profileTopBar}>
          <BackButton onPress={goBack} />
          <LogoLockup compact />
        </View>
        <Text style={styles.accountEyebrow}>DELIVERY PARTNER · PROFILE</Text>
        <Text style={styles.accountTitle}>Connect the last mile</Text>
        <Text style={styles.accountDescription}>Set up the practical details for collecting and delivering local orders.</Text>
        <View style={styles.infoCard}>
          <Ionicons color="#143A73" name="bicycle-outline" size={25} />
          <Text style={styles.infoCardTitle}>A clear assignment, every time</Text>
          <Text style={styles.infoCardText}>See the seller’s pickup details, buyer’s destination and order contents. Mark collection before moving on to delivery.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload your profile picture"
          disabled={isUploadingProfilePhoto}
          onPress={() => void chooseProfilePhoto()}
          style={[styles.imagePicker, { marginTop: 18 }]}
        >
          {profilePhotoUrl ? (
            <Image accessibilityLabel="Delivery partner profile picture" source={{ uri: profilePhotoUrl }} style={styles.imagePreview} />
          ) : (
            <>
              <Ionicons color="#143A73" name="camera-outline" size={40} />
              <Text style={styles.imagePickerText}>{isUploadingProfilePhoto ? 'Uploading your photo…' : 'Upload your photo'}</Text>
              <Text style={styles.imagePickerHint}>Add a clear profile picture</Text>
            </>
          )}
        </Pressable>
        {profilePhotoUrl ? (
          <Pressable disabled={isUploadingProfilePhoto} onPress={() => void chooseProfilePhoto()} style={styles.profilePhotoAction}>
            <Text style={styles.profilePhotoActionText}>{isUploadingProfilePhoto ? 'Uploading picture…' : 'Change profile picture'}</Text>
          </Pressable>
        ) : null}
        <Field label="Display name" value={name} onChangeText={setName} placeholder="Your display name" />
        <Field label="Phone number" value={signupPhone} onChangeText={setSignupPhone} placeholder="+234 801 234 5678" keyboardType="phone-pad" />
        <Field label="Service area" value={serviceArea} onChangeText={setServiceArea} placeholder="Your neighbourhood or delivery zone" />
        <Pressable disabled={isGettingCurrentLocation} onPress={useCurrentLocation} style={[styles.currentLocationButton, isGettingCurrentLocation && styles.disabledButton]}>
          <Ionicons color="#143A73" name="navigate-outline" size={21} style={styles.currentLocationIcon} />
          <Text style={styles.currentLocationButtonText}>{isGettingCurrentLocation ? 'Finding your location…' : 'Use my current location'}</Text>
        </Pressable>
        <Text style={styles.locationHintText}>Location access is optional and only used when you tap the button.</Text>
        <Field label="Address / current location" value={location} onChangeText={setLocation} placeholder="Street or nearby landmark (optional)" />
        <Text style={styles.fieldLabel}>Select ride</Text>
        <View style={styles.choiceRow}>
          {['Bicycle', 'Motorcycle', 'Car', 'Van'].map((ride) => (
            <Pressable key={ride} onPress={() => setVehicle(ride)} style={[styles.choicePill, vehicle === ride && styles.choicePillSelected]}>
              <Text style={[styles.choicePillText, vehicle === ride && styles.choicePillTextSelected]}>{ride}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.formHint}>Vehicle plate and document verification are completed from Rider verification after saving your profile.</Text>
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        <PrimaryButton label="Save profile & continue" disabled={!name.trim() || signupPhone.replace(/\D/g, '').length < 10 || !serviceArea.trim() || !vehicle.trim()} onPress={saveDeliveryProfile} />
      </FormShell>
    );
  }

  if (screen === 'bulkProducts') {
    return (
      <FormShell title="" description="" onBack={() => setScreen('addProduct')} hideHeader>
        <View style={styles.sellerListingTopBar}>
          <BackButton onPress={() => setScreen('addProduct')} />
          <LogoLockup compact />
        </View>
        <Text style={styles.sellerListingEyebrow}>SELLER · BULK LISTINGS</Text>
        <Text style={styles.sellerListingTitle}>Add several products</Text>
        <Text style={styles.sellerListingDescription}>Choose or take one photo per product, then enter its details and choose the category yourself. Up to 10 products per batch.</Text>
        <View style={styles.bulkPhotoActions}>
          <Pressable accessibilityRole="button" disabled={isSavingBulkProducts} onPress={() => void chooseBulkProductImages()} style={styles.bulkPhotoAction}>
            <Ionicons color="#143A73" name="images-outline" size={23} />
            <Text style={styles.bulkPhotoActionText}>Choose photos</Text>
            <Text style={styles.bulkPhotoActionHint}>Select several at once</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={isSavingBulkProducts} onPress={() => void takeBulkProductPhoto()} style={styles.bulkPhotoAction}>
            <Ionicons color="#143A73" name="camera-outline" size={23} />
            <Text style={styles.bulkPhotoActionText}>Take a photo</Text>
            <Text style={styles.bulkPhotoActionHint}>Add one product photo</Text>
          </Pressable>
        </View>
        {bulkProductDrafts.map((draft, index) => (
          <View key={draft.id} style={styles.bulkProductCard}>
            <View style={styles.bulkProductHeading}>
              <Image accessibilityLabel={`Product ${index + 1} photo`} source={{ uri: draft.imageUri }} style={styles.bulkProductImage} />
              <View style={styles.bulkProductHeadingCopy}>
                <Text style={styles.bulkProductTitle}>Product {index + 1}</Text>
                <Text style={styles.bulkProductHint}>Review the photo, then fill in its details.</Text>
              </View>
              <Pressable
                accessibilityLabel={`Remove product ${index + 1}`}
                accessibilityRole="button"
                disabled={isSavingBulkProducts}
                onPress={() => setBulkProductDrafts((current) => current.filter((item) => item.id !== draft.id))}
                style={styles.bulkRemoveButton}
              >
                <Ionicons color="#A43F3F" name="trash-outline" size={20} />
              </Pressable>
            </View>
            <Field label="Product name" value={draft.name} onChangeText={(name) => setBulkProductDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, name } : item))} placeholder="e.g. Yam, apples, tomatoes" />
            <Text style={styles.fieldLabel}>Choose a category</Text>
            <View style={styles.choiceRow}>
              {PRODUCT_CATEGORIES.map((item) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.category === item }}
                  key={item}
                  onPress={() => setBulkProductDrafts((current) => current.map((product) => product.id === draft.id ? { ...product, category: item } : product))}
                  style={[styles.choicePill, draft.category === item && styles.choicePillSelected]}
                >
                  <Text style={[styles.choicePillText, draft.category === item && styles.choicePillTextSelected]}>{item}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.sellerProductFormRow}>
              <View style={styles.sellerProductFormColumn}>
                <Field label="Price (₦)" value={draft.price} onChangeText={(price) => setBulkProductDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, price: price.replace(/[^0-9.]/g, '') } : item))} placeholder="e.g. 4500" keyboardType="decimal-pad" />
              </View>
              <View style={styles.sellerProductFormColumn}>
                <Field label="Stock" value={draft.quantity} onChangeText={(quantity) => setBulkProductDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, quantity: quantity.replace(/[^0-9]/g, '') } : item))} placeholder="e.g. 12" keyboardType="numeric" />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Price is per</Text>
            <View style={styles.sellerUnitChoices}>
              {PRODUCT_UNITS.map((unit) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.unit === unit }}
                  key={unit}
                  onPress={() => setBulkProductDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, unit } : item))}
                  style={[styles.sellerUnitChoice, draft.unit === unit && styles.sellerUnitChoiceSelected]}
                >
                  <Ionicons color={draft.unit === unit ? '#286446' : '#769082'} name={draft.unit === unit ? 'checkmark-circle' : 'ellipse-outline'} size={21} />
                  <Text style={styles.sellerUnitChoiceText}>{unit}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {!bulkProductDrafts.length ? (
          <View style={styles.bulkEmptyState}>
            <Ionicons color="#143A73" name="leaf-outline" size={36} />
            <Text style={styles.bulkEmptyTitle}>Your products will appear here</Text>
            <Text style={styles.bulkEmptyText}>Choose multiple gallery photos or take pictures one at a time.</Text>
          </View>
        ) : null}
        {bulkProductError ? <Text style={styles.authError}>{bulkProductError}</Text> : null}
        <Text style={styles.sellerCurrencyNote}>Each product publishes separately. If one fails, its details stay here so you can retry it. Prices are in Nigerian naira (₦).</Text>
        <PrimaryButton
          label={isSavingBulkProducts ? 'Publishing products…' : `Publish ${bulkProductDrafts.length} product${bulkProductDrafts.length === 1 ? '' : 's'}`}
          disabled={isSavingBulkProducts || !bulkProductDrafts.length}
          onPress={() => void publishBulkProducts()}
        />
      </FormShell>
    );
  }

  if (screen === 'addProduct') {
    return (
      <FormShell title="" description="" onBack={() => { setEditingProductId(null); setScreen('sellerDashboard'); }} hideHeader>
        <View style={styles.sellerListingTopBar}>
          <BackButton onPress={() => { setEditingProductId(null); setScreen('sellerDashboard'); }} />
          <LogoLockup compact />
        </View>
        <Text style={styles.sellerListingEyebrow}>SELLER · {editingProductId ? 'EDIT LISTING' : 'FIRST LISTING'}</Text>
        <Text style={styles.sellerListingTitle}>{editingProductId ? 'Keep your listing fresh' : 'Add to your store'}</Text>
        <Text style={styles.sellerListingDescription}>List local produce, pantry goods, household essentials, or prepared meals. A clear photo and accurate stock help buyers order with confidence.</Text>
        {!editingProductId ? (
          <Pressable accessibilityRole="button" onPress={() => { setBulkProductError(''); setScreen('bulkProducts'); }} style={styles.bulkModeButton}>
            <Ionicons color="#143A73" name="albums-outline" size={20} />
            <Text style={styles.bulkModeButtonText}>Add multiple products with photos</Text>
          </Pressable>
        ) : null}

        <Text style={styles.fieldLabel}>Product photo</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={newProductImage ? 'Replace product photo' : 'Add product photo'} onPress={() => void chooseProductImage()} style={styles.sellerProductPhotoPicker}>
          {newProductImage ? (
            <Image source={{ uri: newProductImage }} style={styles.sellerProductPhoto} />
          ) : (
            <View style={styles.sellerProductPhotoPlaceholder}>
              <Ionicons color="#143A73" name="camera-outline" size={34} />
              <Text style={styles.imagePickerText}>Add a clear product photo</Text>
              <Text style={styles.imagePickerHint}>Choose from your photo library</Text>
            </View>
          )}
        </Pressable>
        {newProductImage ? (
          <Pressable accessibilityRole="button" onPress={() => void chooseProductImage()} style={styles.sellerReplacePhoto}>
            <Text style={styles.sellerReplacePhotoText}>Replace photo · JPG or PNG</Text>
          </Pressable>
        ) : <Text style={styles.formHint}>A product photo is optional, but helps buyers shop with confidence.</Text>}

        <Field label="Product name" value={newProductName} onChangeText={setNewProductName} placeholder="e.g. Vine tomatoes" />
        <View style={styles.sellerProductFormRow}>
          <View style={styles.sellerProductFormColumn}>
            <Field label="Price (₦)" value={newProductPrice} onChangeText={setNewProductPrice} placeholder="e.g. 4500" keyboardType="decimal-pad" />
          </View>
          <View style={styles.sellerProductFormColumn}>
            <Field label="Quantity available" value={newProductQuantity} onChangeText={(value) => setNewProductQuantity(value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 12 or 2.5" keyboardType="decimal-pad" />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Unit</Text>
        <View style={styles.sellerUnitChoices}>
          {PRODUCT_UNITS.map((unit) => {
            const selected = newProductUnit === unit;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={unit}
                onPress={() => setNewProductUnit(unit)}
                style={[styles.sellerUnitChoice, selected && styles.sellerUnitChoiceSelected]}
              >
                <Ionicons color={selected ? '#286446' : '#769082'} name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} />
                <Text style={styles.sellerUnitChoiceText}>{unit}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.variantEditorHeader}>
          <View style={styles.productCopy}>
            <Text style={styles.productName}>Size and pack options</Text>
            <Text style={styles.productStore}>Each option has its own price and stock; buyers can also order by your base unit.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={newProductVariants.length >= 20}
            onPress={() => setNewProductVariants((current) => current.length >= 20 ? current : [...current, {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: '',
              unit: 'pack',
              price: '',
              stock: '',
            }])}
            style={[styles.variantAddButton, newProductVariants.length >= 20 && styles.cartQuantityButtonDisabled]}
          >
            <Ionicons color="#143A73" name="add-circle-outline" size={20} />
            <Text style={styles.variantAddButtonText}>Add size</Text>
          </Pressable>
        </View>
        {newProductVariants.map((variant, index) => (
          <View key={variant.id} style={styles.variantEditorCard}>
            <View style={styles.variantEditorHeader}>
              <Text style={styles.productName}>Size option {index + 1}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove size option ${index + 1}`}
                onPress={() => setNewProductVariants((current) => current.filter((item) => item.id !== variant.id))}
              >
                <Ionicons color="#A43F3F" name="trash-outline" size={19} />
              </Pressable>
            </View>
            <Field label="Size or pack name" value={variant.name} onChangeText={(name) => setNewProductVariants((current) => current.map((item) => item.id === variant.id ? { ...item, name } : item))} placeholder="e.g. 500 g bag" />
            <View style={styles.sellerProductFormRow}>
              <View style={styles.sellerProductFormColumn}>
                <Field label="Price (₦)" value={variant.price} onChangeText={(price) => setNewProductVariants((current) => current.map((item) => item.id === variant.id ? { ...item, price: price.replace(/[^0-9.]/g, '') } : item))} placeholder="e.g. 2500" keyboardType="decimal-pad" />
              </View>
              <View style={styles.sellerProductFormColumn}>
                <Field label="Packs in stock" value={variant.stock} onChangeText={(stock) => setNewProductVariants((current) => current.map((item) => item.id === variant.id ? { ...item, stock: stock.replace(/[^0-9.]/g, '') } : item))} placeholder="e.g. 8" keyboardType="decimal-pad" />
              </View>
            </View>
          </View>
        ))}

        <Text style={styles.fieldLabel}>Product category</Text>
        <View style={styles.choiceRow}>
          {PRODUCT_CATEGORIES.map((item) => (
            <Pressable key={item} onPress={() => setNewProductCategory(item)} style={[styles.choicePill, newProductCategory === item && styles.choicePillSelected]}>
              <Text style={[styles.choicePillText, newProductCategory === item && styles.choicePillTextSelected]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Short description" value={newProductDescription} onChangeText={setNewProductDescription} placeholder="Tell buyers what makes it fresh" multiline />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: newProductAvailable && Number(newProductQuantity) > 0 }}
          disabled={Number(newProductQuantity) <= 0}
          onPress={() => setNewProductAvailable((available) => !available)}
          style={styles.sellerAvailabilityRow}
        >
          <View style={styles.sellerAvailabilityCopy}>
            <Text style={styles.sellerAvailabilityTitle}>Available to order</Text>
            <Text style={styles.sellerAvailabilityHint}>{Number(newProductQuantity) > 0 ? 'Switch off when stock runs out.' : 'Add stock to make this listing available.'}</Text>
          </View>
          <View style={[styles.sellerAvailabilityPill, newProductAvailable && Number(newProductQuantity) > 0 && styles.sellerAvailabilityPillOn]}>
            <Text style={[styles.sellerAvailabilityPillText, newProductAvailable && Number(newProductQuantity) > 0 && styles.sellerAvailabilityPillTextOn]}>
              {newProductAvailable && Number(newProductQuantity) > 0 ? '✓ ON' : 'OFF'}
            </Text>
          </View>
        </Pressable>
        <Text style={styles.sellerCurrencyNote}>Prices are shown in Nigerian naira (₦).</Text>
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        <PrimaryButton
          label={isSavingProduct ? 'Publishing…' : editingProductId ? 'Save listing' : 'Publish product'}
          disabled={isSavingProduct || !newProductName.trim() || !newProductPrice.trim() || !newProductQuantity.trim()}
          onPress={() => void addProduct()}
        />
      </FormShell>
    );
  }

  if (screen === 'dashboard') {
    const marketProducts = remoteProducts.filter((product) => {
      const matchesLocation = matchesLocalMarket(product, area, location);
      const matchesSearch = `${product.name} ${product.store} ${product.description || ''}`.toLowerCase().includes(search.trim().toLowerCase());
      const matchesCategory = matchesMarketplaceCategory(product, category);
      const matchesVerification = !verifiedStoresOnly || product.storeVerified;
      return matchesLocation && matchesSearch && matchesCategory && matchesVerification;
    });
    const recentOrder = orders[0];

    return (
      <Shell
        toast={toast}
      >
        <View style={styles.marketBar}>
          <LogoLockup compact />
          <View style={styles.headerActions}>
            {!isGuestBrowsing ? <NotificationButton unreadCount={notifications.filter((item) => !item.read_at).length + marketplaceAlerts.filter((item) => !item.read_at).length} onPress={() => setScreen('notifications')} /> : null}
            <Pressable accessibilityRole="button" onPress={() => setScreen('cart')} style={styles.marketBasketWrap}>
              <Ionicons color="#143A73" name="cart-outline" size={25} />
              <View style={styles.marketBasketBadge}><Text style={styles.marketBasketBadgeText}>{getCartCount(cart)}</Text></View>
            </Pressable>
          </View>
        </View>

        <Pressable accessibilityRole="button" onPress={() => { setIsEditingProfile(true); setScreen('location'); }} style={styles.locationPanel}>
          <Ionicons color="#1D4E89" name="location" size={19} style={styles.locationPin} />
          <View style={styles.locationTextWrap}>
            <Text style={styles.locationLabel}>SHOPS NEAR YOU</Text>
            <Text style={styles.locationValue}>{location ? `${location}${area ? ` • ${area}` : ''}` : 'Add your delivery location'}</Text>
          </View>
          <Ionicons color="#7D91A8" name="chevron-down" size={18} />
        </Pressable>

        <View style={styles.searchPanel}>
          <Ionicons color="#143A73" name="search-outline" size={22} style={styles.searchIcon} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products or stores"
            placeholderTextColor="#7E8C82"
            style={styles.searchInput}
          />
        </View>

        <View style={styles.marketHero}>
          <Text style={styles.marketHeroEyebrow}>{area ? `${area.toUpperCase()} MARKET` : 'LOCAL MARKET'}</Text>
          <Text style={styles.marketHeroTitle}>{`Fresh picks.\nRight around you.`}</Text>
          <Text style={styles.marketHeroText}>{area || location ? `Showing available products from shops in ${area || location}.` : 'Set your area to see shops and products close to you.'}</Text>
        </View>

        <View style={styles.marketFilterHeader}>
          <View style={styles.marketFilterHeadingCopy}>
            <Text style={styles.marketCategoryHeading}>Browse all categories</Text>
            <Text style={styles.marketFilterHint}>Explore produce, packaged goods, kitchen utensils, and restaurant menus.</Text>
          </View>
          {category !== 'All' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setCategory('All')}
              style={styles.marketFilterClear}
            >
              <Text style={styles.marketFilterClearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryWrap}>
          {MARKETPLACE_CATEGORY_FILTERS.map((item) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: category === item }}
              key={item}
              onPress={() => setCategory(item)}
              style={[styles.marketChip, category === item && styles.marketChipActive]}
            >
              <Text style={[styles.marketChipText, category === item && styles.marketChipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: verifiedStoresOnly }}
          onPress={() => setVerifiedStoresOnly((current) => !current)}
          style={[styles.verifiedOnlyFilter, verifiedStoresOnly && styles.verifiedOnlyFilterActive]}
        >
          <Ionicons
            color={verifiedStoresOnly ? '#0F6B46' : '#536A86'}
            name={verifiedStoresOnly ? 'checkbox' : 'square-outline'}
            size={20}
          />
          <Text style={styles.verifiedOnlyFilterText}>Show verified stores only</Text>
          <Ionicons color="#0F6B46" name="checkmark-circle" size={16} />
        </Pressable>

        <View style={styles.marketSectionHeader}>
          <Text style={styles.marketSectionTitle}>{category === 'All' ? (area ? `In ${area}` : 'Nearby products') : category}</Text>
          <Text style={styles.marketSectionMeta}>{isLoadingProducts
            ? 'Loading…'
            : `${remoteProducts.length}${hasMoreProducts ? '+' : ''} nearby`}</Text>
        </View>

        {marketError ? <Text style={styles.authError}>{marketError}</Text> : null}
        {marketProducts.length === 0 && !isLoadingProducts ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}><Ionicons color="#1B4D8F" name="location-outline" size={38} /></View>
            <Text style={styles.emptyTitle}>{!area && !location ? 'Choose your area first' : search || category !== 'All' || verifiedStoresOnly ? 'No nearby matches' : 'No shops nearby yet'}</Text>
            <Text style={styles.emptyText}>{!area && !location
              ? 'Add your neighbourhood, such as Kubwa, so we can show shops in your area instead of distant locations.'
              : search || category !== 'All' || verifiedStoresOnly
                ? 'Try another search or category, clear the category filter, or turn off the verified-stores filter.'
                : `No available shops have listed their market area as ${area || location}. You can update your area to browse another neighbourhood.`}</Text>
            {!area && !location ? (
              <PrimaryButton label="Set my area" onPress={() => { setIsEditingProfile(true); setScreen('location'); }} />
            ) : null}
          </View>
        ) : null}
        <View style={styles.productGrid}>
          {marketProducts.map((product) => (
            <View key={product.id} style={styles.marketProductCard}>
              <Pressable
                accessibilityLabel={`View details for ${product.name}`}
                accessibilityRole="button"
                onPress={() => openProductDetail(product, 'dashboard')}
              >
                {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.marketProductImage} /> : <View style={[styles.marketProductImage, styles.productImage]}><Ionicons color="#5C7FA9" name="leaf-outline" size={31} /></View>}
                <View style={styles.marketProductInfo}>
                  <Text style={styles.marketProductName}>{product.name}</Text>
                  <Text style={styles.marketProductPrice}>{product.price}</Text>
                  <View style={styles.marketProductStoreRow}>
                    <Text style={styles.marketProductStore}>{product.store}</Text>
                    {product.storeVerified ? <StoreVerifiedMark /> : null}
                  </View>
                  <Text style={styles.marketProductMeta}>{product.variants?.length ? `${product.quantity} ${product.unit} base · ${product.variants.length} size option${product.variants.length === 1 ? '' : 's'}` : `${product.quantity} ${product.unit} available`}</Text>
                </View>
              </Pressable>
              <View style={styles.marketProductFooter}>
                <Pressable onPress={() => openProductDetail(product, 'dashboard')}><Text style={styles.marketProductLink}>View details</Text></Pressable>
                <Pressable accessibilityLabel={saved.some((item) => item.id === product.id) ? 'Remove from saved products' : 'Save product'} accessibilityRole="button" onPress={() => toggleSavedProduct(product)} style={styles.saveButton}><Ionicons color="#143A73" name={saved.some((item) => item.id === product.id) ? 'heart' : 'heart-outline'} size={21} /></Pressable>
                <Pressable onPress={() => addToCart(product)} style={styles.marketProductAdd}>
                  <Ionicons color="#D5F0FF" name="add" size={23} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        {hasMoreProducts ? (
          <Pressable
            accessibilityRole="button"
            disabled={isLoadingMoreProducts}
            onPress={() => void loadMoreMarketplaceProducts()}
            style={[styles.marketLoadMoreButton, isLoadingMoreProducts && styles.disabledButton]}
          >
            <Text style={styles.marketLoadMoreText}>{isLoadingMoreProducts ? 'Loading more…' : 'Load more products'}</Text>
          </Pressable>
        ) : null}

        {recentOrder ? <View style={styles.recentOrderCard}>
          <View style={styles.recentOrderHeader}>
            <Text style={styles.recentOrderTitle}>Your recent order</Text>
            <View style={styles.orderStatusPill}><Text style={styles.orderStatusText}>{recentOrder.status.replace('_', ' ')}</Text></View>
          </View>
          <Text style={styles.recentOrderId}>Order #{recentOrder.id.slice(0, 6)}</Text>
          <Text style={styles.recentOrderAddress}>{recentOrder.deliveryAddress}</Text>
          <Text style={styles.recentOrderItems}>
            {recentOrder.items.map((item) => `${item.quantity || 1} ${item.unit || 'item'} ${item.name}`).join(' + ') || 'Order item details are unavailable.'}
          </Text>
          <View style={styles.orderProgressTrack}>
            {[
              ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'].includes(recentOrder.status),
              ['ready', 'out_for_delivery', 'completed'].includes(recentOrder.status),
              recentOrder.status === 'completed',
            ].map((complete, index) => (
              <View key={index} style={complete ? styles.orderProgressSegmentFilled : styles.orderProgressSegmentEmpty} />
            ))}
          </View>
          <View style={styles.orderProgressLabels}>
            <Text style={styles.progressLabel}>{recentOrder.status === 'pending' ? 'Placed' : 'Confirmed'}</Text>
            <Text style={styles.progressLabel}>{recentOrder.status === 'out_for_delivery' || recentOrder.status === 'completed' ? 'In transit' : 'Ready'}</Text>
            <Text style={styles.progressLabel}>Delivered</Text>
          </View>
          <Text style={styles.orderSummaryText}>
            {recentOrder.status === 'completed' ? 'Order delivered' : `Delivery requested · ${recentOrder.status.replace('_', ' ')}`}
            {' · Items '}{formatCurrency(recentOrder.total)}
          </Text>
          <Pressable onPress={() => setScreen('orders')} style={styles.orderLinkButton}>
            <View style={styles.orderLinkContent}><Text style={styles.orderLinkText}>View order details</Text><Ionicons color="#0F3D6E" name="arrow-forward" size={17} /></View>
          </Pressable>
        </View> : null}
        {ordersError ? <Text style={styles.authError}>{ordersError}</Text> : null}
        {dashboardNotice ? <Text style={styles.dashboardNotice}>{dashboardNotice}</Text> : null}
      </Shell>
    );
  }

  if (screen === 'storefront' && productDetail?.storeId) {
    const storeProducts = remoteProducts.filter((product) => matchesLocalMarket(product, area, location) && product.storeId === productDetail.storeId);
    const averageRating = storefrontReviews.length
      ? storefrontReviews.reduce((sum, review) => sum + Number(review.rating), 0) / storefrontReviews.length
      : 0;
    return (
      <Shell toast={toast}>
        <BackButton onPress={() => setScreen(storefrontReturnScreen)} />
        <View style={styles.storefrontHeader}>
          <View style={styles.storefrontIcon}><Ionicons color="#143A73" name="storefront-outline" size={30} /></View>
          <View style={styles.storefrontHeading}>
            <Text style={styles.pageTitleLeft}>{productDetail.store}</Text>
            {productDetail.storeVerified ? <StoreVerifiedMark /> : null}
          </View>
          <Text style={styles.storefrontRating}>
            {storefrontReviews.length ? `★ ${averageRating.toFixed(1)} · ${storefrontReviews.length} review${storefrontReviews.length === 1 ? '' : 's'}` : 'No reviews yet'}
          </Text>
          <Text style={styles.pageDescriptionLeft}>Reviews from buyers who completed an order with this store.</Text>
        </View>

        <View style={styles.storefrontSection}>
          <Text style={styles.dashboardSectionTitle}>Buyer comments</Text>
          {isLoadingStorefrontReviews ? <Text style={styles.emptyText}>Loading reviews…</Text> : null}
          {storefrontReviewsError ? <Text style={styles.authError}>{storefrontReviewsError}</Text> : null}
          {!isLoadingStorefrontReviews && !storefrontReviewsError && storefrontReviews.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}><Ionicons color="#1B4D8F" name="chatbubble-ellipses-outline" size={38} /></View>
              <Text style={styles.emptyTitle}>No buyer comments yet</Text>
              <Text style={styles.emptyText}>After a completed order, buyers can leave a rating and comment here.</Text>
            </View>
          ) : storefrontReviews.map((review, index) => (
            <View key={`${review.created_at}-${index}`} style={styles.storeReviewCard}>
              <View style={styles.storeReviewHeader}>
                <View style={styles.storeBuyerBadge}><Ionicons color="#1D4E89" name="person-outline" size={16} /></View>
                <View style={styles.storeReviewMeta}>
                  <Text style={styles.storeReviewBuyer}>{review.buyer_label}</Text>
                  <Text style={styles.storeReviewDate}>{new Date(review.created_at).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.storeReviewStars}>{'★'.repeat(Number(review.rating))}{'☆'.repeat(5 - Number(review.rating))}</Text>
              </View>
              <Text style={styles.storeReviewComment}>{review.review || 'Buyer left a rating without a written comment.'}</Text>
              <Text style={styles.storeVerifiedPurchase}>Verified purchase</Text>
            </View>
          ))}
        </View>

        <View style={styles.storefrontSection}>
          <Text style={styles.dashboardSectionTitle}>Products from this store</Text>
          {storeProducts.length === 0 ? (
            <Text style={styles.emptyText}>This store has no currently available products.</Text>
          ) : storeProducts.map((product) => (
            <View key={product.id} style={styles.storefrontProductCard}>
              <Pressable onPress={() => openProductDetail(product, 'storefront')} style={styles.storefrontProductDetails}>
                {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.storefrontProductImage} /> : <View style={styles.storefrontProductImageFallback}><Ionicons color="#5C7FA9" name="leaf-outline" size={25} /></View>}
                <View style={styles.productCopy}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productStore}>{product.variants?.length ? `${product.quantity} ${product.unit} base · ${product.variants.length} sizes` : `${product.quantity} ${product.unit} available`}</Text>
                  <Text style={styles.productPrice}>{product.price}</Text>
                </View>
              </Pressable>
              <Pressable accessibilityLabel={`Add ${product.name} to cart`} accessibilityRole="button" onPress={() => addToCart(product)} style={styles.addButton}>
                <Ionicons color="#D5F0FF" name="add" size={23} />
              </Pressable>
            </View>
          ))}
        </View>
      </Shell>
    );
  }

  if (screen === 'productDetail' && productDetail) {
    const selectedVariant = productDetail.variants?.find((variant) => variant.id === selectedProductVariantId);
    const productCartQuantity = productDetail.id
      ? cart.find((line) => line.key === `${productDetail.id}:${selectedVariant?.id || 'base'}`)?.quantity || 0
      : 0;
    const requestedQuantity = Number(customProductQuantity) > 0 ? Number(customProductQuantity) : 1;
    const selectedPrice = selectedVariant?.price ?? getProductUnitPrice(productDetail);
    const selectedStock = selectedVariant?.stock ?? Number(productDetail.quantity || 0);
    const relatedProducts = remoteProducts.filter((product) => matchesLocalMarket(product, area, location) && product.id !== productDetail.id
      && product.category === productDetail.category).slice(0, 4);
    const sameStoreProducts = remoteProducts.filter((product) => matchesLocalMarket(product, area, location) && product.id !== productDetail.id
      && product.storeId === productDetail.storeId).slice(0, 4);
    const storeAverage = storefrontReviews.length
      ? storefrontReviews.reduce((sum, review) => sum + Number(review.rating), 0) / storefrontReviews.length
      : 0;
    return (
      <Shell toast={toast}>
        <View style={styles.detailTopBar}>
          <BackButton onPress={() => setScreen(productDetailReturnScreen)} />
          <Pressable accessibilityLabel={`Open cart, ${getCartCount(cart)} items`} accessibilityRole="button" onPress={() => setScreen('cart')} style={styles.detailCartButton}>
            <Ionicons color="#143A73" name="cart-outline" size={23} />
            <View style={styles.marketBasketBadge}><Text style={styles.marketBasketBadgeText}>{getCartCount(cart)}</Text></View>
          </Pressable>
        </View>
        <View style={styles.detailPanel}>
          <View style={styles.detailGallery}>
            {productDetail.imageUrl
              ? <Image accessibilityLabel={`${productDetail.name} product photo`} source={{ uri: productDetail.imageUrl }} style={styles.detailImage} />
              : <View style={styles.detailImageFallback}><Ionicons color="#5C7FA9" name="leaf-outline" size={50} /></View>}
            <View style={styles.detailGalleryCount}><Text style={styles.detailGalleryCountText}>Product photo</Text></View>
          </View>
          <View style={styles.detailTitleRow}>
            <Text style={styles.detailTitle}>{productDetail.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={saved.some((item) => item.id === productDetail.id) ? 'Remove from saved products' : 'Save product'} onPress={() => toggleSavedProduct(productDetail)} style={styles.detailSaveButton}>
              <Ionicons color="#143A73" name={saved.some((item) => item.id === productDetail.id) ? 'heart' : 'heart-outline'} size={22} />
            </Pressable>
          </View>
          <View style={styles.marketProductStoreRow}>
            {productDetail.storeId ? (
              <Pressable accessibilityRole="button" onPress={() => openStorefront('productDetail')}>
                <Text style={[styles.marketProductStore, styles.storefrontLink]}>{productDetail.store} · View store</Text>
              </Pressable>
            ) : <Text style={styles.marketProductStore}>{productDetail.store}</Text>}
            {productDetail.storeVerified ? <StoreVerifiedMark /> : null}
          </View>
          <View style={styles.detailRatingRow}>
            <Text style={styles.detailRatingStars}>{storefrontReviews.length ? `★ ${storeAverage.toFixed(1)}` : '☆ No ratings yet'}</Text>
            <Text style={styles.detailRatingCaption}>{storefrontReviews.length ? `${storefrontReviews.length} verified store review${storefrontReviews.length === 1 ? '' : 's'}` : 'Store rating'}</Text>
          </View>
          <Text style={styles.marketProductPrice}>{formatCurrency(selectedPrice)} / {selectedVariant?.unit || productDetail.unit}</Text>
          <View style={styles.detailMetaRow}>
            <View style={styles.detailMetaItem}><Text style={styles.detailMetaLabel}>CATEGORY</Text><Text style={styles.detailMetaValue}>{productDetail.category}</Text></View>
            <View style={styles.detailMetaItem}><Text style={styles.detailMetaLabel}>AVAILABLE</Text><Text style={styles.detailMetaValue}>{selectedStock} {selectedVariant ? `${selectedVariant.name} packs` : productDetail.unit || 'item'}</Text></View>
          </View>
          {productDetail.variants?.length ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Choose a size</Text>
              {Number(productDetail.quantity || 0) > 0 ? (
                <Pressable accessibilityRole="radio" accessibilityState={{ selected: !selectedVariant }} onPress={() => { setSelectedProductVariantId(null); setCustomProductQuantity(''); }} style={[styles.sizeChoice, !selectedVariant && styles.sizeChoiceSelected]}>
                  <View><Text style={styles.sizeChoiceName}>Custom amount</Text><Text style={styles.sizeChoiceMeta}>{productDetail.unit} · {formatCurrency(getProductUnitPrice(productDetail))} per {productDetail.unit}</Text></View>
                  {!selectedVariant ? <Ionicons color="#1D6A46" name="checkmark-circle" size={21} /> : null}
                </Pressable>
              ) : null}
              {productDetail.variants.map((variant) => (
                <Pressable key={variant.id} accessibilityRole="radio" accessibilityState={{ selected: selectedVariant?.id === variant.id }} onPress={() => { setSelectedProductVariantId(variant.id); setCustomProductQuantity(''); }} style={[styles.sizeChoice, selectedVariant?.id === variant.id && styles.sizeChoiceSelected]}>
                  <View><Text style={styles.sizeChoiceName}>{variant.name}</Text><Text style={styles.sizeChoiceMeta}>{variant.stock} available · {formatCurrency(variant.price)} / {variant.unit}</Text></View>
                  {selectedVariant?.id === variant.id ? <Ionicons color="#1D6A46" name="checkmark-circle" size={21} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>{selectedVariant ? `Quantity (${selectedVariant.unit})` : `Amount (${productDetail.unit || 'item'})`}</Text>
            <TextInput
              accessibilityLabel={selectedVariant ? 'Enter pack quantity' : `Enter ${productDetail.unit || 'item'} amount`}
              keyboardType="decimal-pad"
              onChangeText={(value) => setCustomProductQuantity(value.replace(/[^0-9.]/g, ''))}
              placeholder={selectedVariant ? 'e.g. 2' : 'e.g. 0.5'}
              style={styles.customQuantityInput}
              value={customProductQuantity}
            />
            <Text style={styles.detailPriceEstimate}>Estimated total · {formatCurrency(selectedPrice * requestedQuantity)}</Text>
          </View>
          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>About this product</Text>
            <Text style={styles.pageDescriptionLeft}>{productDetail.description || 'The seller has not added a product description yet.'}</Text>
            <Text style={styles.detailMetaValue}>{productDetail.category} · Sold by {productDetail.store}</Text>
          </View>
          <PrimaryButton
            label={`Add to cart · ${formatCurrency(selectedPrice * requestedQuantity)}`}
            onPress={() => addToCart(productDetail, requestedQuantity, selectedVariant, !selectedVariant)}
            disabled={!productDetail.isAvailable || selectedStock <= 0 || requestedQuantity <= 0 || !Number.isFinite(requestedQuantity)
              || Math.round(requestedQuantity * 100) !== requestedQuantity * 100
              || productCartQuantity + requestedQuantity > selectedStock}
          />
          {!productDetail.isAvailable && productDetail.id ? (
            <SecondaryButton
              label={productStockAlertIds.has(productDetail.id) ? 'Turn off back-in-stock alert' : 'Alert me when available'}
              onPress={() => void toggleProductStockAlert(productDetail)}
            />
          ) : null}
          {productCartQuantity > 0 ? <SecondaryButton label={`Go to cart · ${productCartQuantity} ${selectedVariant?.unit || productDetail.unit}`} onPress={() => setScreen('cart')} /> : null}
        </View>
        <View style={styles.detailSection}>
          <View style={styles.detailSectionHeading}>
            <Text style={styles.detailSectionTitle}>Store buyer reviews</Text>
            {productDetail.storeId ? <Pressable onPress={() => openStorefront('productDetail')}><Text style={styles.marketProductLink}>All store reviews</Text></Pressable> : null}
          </View>
          {isLoadingStorefrontReviews ? <Text style={styles.emptyText}>Loading verified buyer reviews…</Text> : null}
          {storefrontReviewsError ? <Text style={styles.authError}>{storefrontReviewsError}</Text> : null}
          {!isLoadingStorefrontReviews && !storefrontReviewsError && !storefrontReviews.length ? (
            <Text style={styles.emptyText}>No verified buyer reviews yet. Reviews appear after a buyer completes an order.</Text>
          ) : storefrontReviews.slice(0, 2).map((review, index) => (
            <View key={`${review.created_at}-${index}`} style={styles.storeReviewCard}>
              <View style={styles.storeReviewHeader}>
                <Text style={styles.storeReviewBuyer}>{review.buyer_label}</Text>
                <Text style={styles.storeReviewStars}>{'★'.repeat(Number(review.rating))}{'☆'.repeat(5 - Number(review.rating))}</Text>
              </View>
              <Text style={styles.storeReviewComment}>{review.review || 'Buyer left a rating without a written comment.'}</Text>
              <Text style={styles.storeVerifiedPurchase}>Verified store purchase</Text>
            </View>
          ))}
        </View>
        {sameStoreProducts.length ? (
          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>More from {productDetail.store}</Text>
            {sameStoreProducts.map((product) => (
              <Pressable key={product.id} onPress={() => openProductDetail(product, productDetailReturnScreen)} style={styles.relatedProductCard}>
                <CartProductImage imageUrl={product.imageUrl} />
                <View style={styles.productCopy}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productStore}>{product.price}</Text></View>
                <Ionicons color="#143A73" name="chevron-forward" size={19} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {relatedProducts.length ? (
          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>Similar products</Text>
            {relatedProducts.map((product) => (
              <Pressable key={product.id} onPress={() => openProductDetail(product, productDetailReturnScreen)} style={styles.relatedProductCard}>
                <CartProductImage imageUrl={product.imageUrl} />
                <View style={styles.productCopy}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productStore}>{product.store}</Text><Text style={styles.productPrice}>{product.price}</Text></View>
                <Ionicons color="#143A73" name="chevron-forward" size={19} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Shell>
    );
  }

  if (screen === 'cart') {
    const cartSubtotal = getCartSubtotal(selectedCartLines);
    const cartCategories = [...new Set(cart.map((line) => line.product.category || 'Products'))];
    return (
      <Shell toast={toast}>
        <BackButton onPress={goBack} />
        <View style={styles.cartHeader}>
          <View style={styles.cartHeaderCopy}>
            <Text style={styles.pageTitleLeft}>Your cart</Text>
            <Text style={styles.pageDescriptionLeft}>Review your items before placing your order.</Text>
          </View>
          <View style={styles.cartCountBadge}>
            <Ionicons color="#143A73" name="bag-handle-outline" size={18} />
            <Text style={styles.cartCountText}>{getCartCount(cart)}</Text>
          </View>
        </View>
        {cart.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.cartEmptyIconWrap}>
              <Ionicons color="#1B4D8F" name="cart-outline" size={48} />
            </View>
            <Text style={styles.emptyTitle}>Your cart is empty</Text>
            <Text style={styles.emptyText}>Your local finds will be waiting here when you add them.</Text>
            <PrimaryButton label="Browse products" onPress={() => setScreen('dashboard')} />
          </View>
        ) : (
          <>
            <View style={styles.cartSelectAllRow}>
              <Text style={styles.productStore}>{selectedCartLines.length} selected</Text>
              <Pressable onPress={() => setSelectedCartKeys(selectedCartKeys.size === cart.length ? new Set() : new Set(cart.map((line) => line.key)))}>
                <Text style={styles.marketProductLink}>{selectedCartKeys.size === cart.length ? 'Clear selection' : 'Select all'}</Text>
              </Pressable>
            </View>
            {cartCategories.map((group) => (
              <View key={group} style={styles.cartCategoryGroup}>
                <Text style={styles.cartCategoryTitle}>{group}</Text>
                {cart.filter((line) => (line.product.category || 'Products') === group).map((line) => {
                  const product = line.product;
                  const selected = selectedCartKeys.has(line.key);
                  const unit = line.variant?.unit || product.unit || 'item';
                  const available = line.variant?.stock ?? Number(product.quantity || 0);
                  const unitPrice = getCartLineUnitPrice(line);
                  return (
                    <View key={line.key} style={[styles.cartRow, !selected && styles.cartRowUnselected]}>
                      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${product.name}`} onPress={() => toggleCartLineSelected(line.key)} style={[styles.cartCheckButton, selected && styles.cartCheckButtonSelected]}>
                        {selected ? <Ionicons color="#FFF" name="checkmark" size={16} /> : null}
                      </Pressable>
                      <CartProductImage imageUrl={product.imageUrl} />
                      <View style={styles.cartItemDetails}>
                        <Text style={styles.productName}>{product.name}{line.variant ? ` · ${line.variant.name}` : ''}</Text>
                        <Text style={styles.productStore}>{product.store}</Text>
                        <Text style={styles.cartProductMeta}>{unit} · {formatCurrency(unitPrice)} / {unit}</Text>
                        <Text style={styles.cartLineTotal}>{formatCurrency(unitPrice * line.quantity)}</Text>
                        <Text style={styles.cartAvailability}>{available} {line.variant ? `${line.variant.name} packs` : unit} available</Text>
                        <View style={styles.cartQuantityControls}>
                          <Pressable accessibilityLabel={`Decrease ${product.name} quantity`} accessibilityRole="button" onPress={() => removeOneFromCart(line.key)} style={styles.cartQuantityButton}>
                            <Ionicons color="#143A73" name="remove" size={19} />
                          </Pressable>
                          <Text accessibilityLabel={`Quantity ${line.quantity} ${unit}`} style={styles.cartQuantityText}>{line.quantity} {unit}</Text>
                          <Pressable accessibilityLabel={`Increase ${product.name} quantity`} accessibilityRole="button" disabled={available <= 0 || line.quantity >= available} onPress={() => addToCart(product, 1, line.variant, line.customQuantity)} style={[styles.cartQuantityButton, (available <= 0 || line.quantity >= available) && styles.cartQuantityButtonDisabled]}>
                            <Ionicons color="#143A73" name="add" size={19} />
                          </Pressable>
                          <Pressable accessibilityLabel={`Remove ${product.name} from cart`} accessibilityRole="button" onPress={() => removeCartLine(line.key)} style={styles.cartRemoveButton}>
                            <Ionicons color="#A43F3F" name="trash-outline" size={19} />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setIsPromoSheetVisible(true)} style={styles.cartPromoButton}>
              <Ionicons color="#143A73" name="pricetag-outline" size={21} />
              <View style={styles.productCopy}><Text style={styles.productName}>{promoDiscount > 0 ? 'Promo applied' : 'Have a promo code?'}</Text><Text style={styles.productStore}>{promoDiscount > 0 ? `${promoCode} · ${formatCurrency(promoDiscount)} off` : 'Apply a seller discount to selected items'}</Text></View>
              <Ionicons color="#143A73" name="chevron-forward" size={19} />
            </Pressable>
            <View style={styles.cartSummaryCard}>
              <View style={styles.cartSummaryLine}>
                <Text style={styles.cartSummaryLabel}>Selected subtotal · {getCartCount(selectedCartLines)} {getCartCount(selectedCartLines) === 1 ? 'item' : 'items'}</Text>
                <Text style={styles.cartSummaryAmount}>{formatCurrency(cartSubtotal)}</Text>
              </View>
              {promoDiscount > 0 ? <View style={styles.cartSummaryLine}><Text style={styles.cartSummaryLabel}>Promo discount</Text><Text style={styles.cartSummaryAmount}>−{formatCurrency(promoDiscount)}</Text></View> : null}
              <Text style={styles.cartSummaryHint}>Delivery details are confirmed at checkout.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={!selectedCartLines.length}
              onPress={() => setScreen('checkout')}
              style={({ pressed }) => [styles.cartCheckoutButton, (pressed || !selectedCartLines.length) && styles.pressedButton]}
            >
              <Text style={styles.cartCheckoutText}>{selectedCartLines.length ? `Checkout · ${formatCurrency(Math.max(0, cartSubtotal - promoDiscount))}` : 'Select items to continue'}</Text>
              <Ionicons color="#FFF" name="arrow-forward" size={19} />
            </Pressable>
          </>
        )}
        <Modal animationType="slide" transparent visible={isPromoSheetVisible} onRequestClose={() => setIsPromoSheetVisible(false)}>
          <View style={styles.promoModalOverlay}>
            <Pressable accessibilityLabel="Close promo panel" onPress={() => setIsPromoSheetVisible(false)} style={styles.promoModalBackdrop} />
            <View style={styles.promoModalCard}>
              <View style={styles.promoModalHeader}>
                <View><Text style={styles.detailSectionTitle}>Apply a promo code</Text><Text style={styles.productStore}>Discount applies to eligible products only.</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setIsPromoSheetVisible(false)}><Ionicons color="#52677D" name="close" size={24} /></Pressable>
              </View>
              <TextInput autoCapitalize="characters" onChangeText={(value) => { setPromoCode(value.toUpperCase()); setPromoDiscount(0); setPromoMessage(''); }} placeholder="Enter code" style={styles.promoCodeInput} value={promoCode} />
              {promoMessage ? <Text style={promoDiscount > 0 ? styles.dashboardNotice : styles.authError}>{promoMessage}</Text> : null}
              <PrimaryButton label={isApplyingPromo ? 'Checking code…' : 'Apply code'} disabled={isApplyingPromo || !selectedCartLines.length} onPress={() => void applyPromoCode()} />
            </View>
          </View>
        </Modal>
      </Shell>
    );
  }

  if (screen === 'checkout') {
    const checkoutSubtotal = getCartSubtotal(selectedCartLines);
    const deliveryFee = getDeliveryFee(location);
    const bookingFee = 100;
    const roadDevelopmentLevy = 100;
    const checkoutTotal = Math.max(0, checkoutSubtotal - promoDiscount) + deliveryFee + bookingFee + roadDevelopmentLevy;
    const todayLagos = getLagosDate();
    const deliveryDateOptions = Array.from({ length: 15 }, (_, index) => {
      const date = new Date(`${todayLagos}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return {
        value: date.toISOString().slice(0, 10),
        label: index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : new Intl.DateTimeFormat('en-NG', {
          timeZone: 'Africa/Lagos',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(date),
      };
    });

    return (
      <FormShell title={isGuestBrowsing ? 'Your cart is ready' : 'Checkout'} description={isGuestBrowsing ? 'Create an account or sign in when you’re ready to place your order.' : 'Confirm your delivery details and payment method.'} onBack={() => setScreen('cart')}>
        {isGuestBrowsing ? (
          <>
            <View style={styles.guestCheckoutCard}>
              <View style={styles.guestCheckoutIcon}><Ionicons color="#143A73" name="cart-outline" size={28} /></View>
              <Text style={styles.guestCheckoutTitle}>{getCartCount(cart)} {getCartCount(cart) === 1 ? 'item' : 'items'} in your cart</Text>
              <Text style={styles.guestCheckoutDescription}>Your cart is saved on this device. Sign up or sign in to add delivery details and place your order.</Text>
              <View style={styles.totalCard}>
                <Text style={styles.productName}>Subtotal</Text>
                <Text style={styles.totalValue}>{formatCurrency(checkoutSubtotal)}</Text>
              </View>
            </View>
            <PrimaryButton label="Create account to continue" onPress={() => {
              checkoutAfterAuth.current = true;
              setAuthError('');
              setRole('buyer');
              setScreen('create');
            }} />
            <SecondaryButton label="I already have an account" onPress={() => {
              checkoutAfterAuth.current = true;
              setAuthError('');
              setRole('buyer');
              setScreen('signin');
            }} />
            {authError ? <Text style={styles.authError}>{authError}</Text> : null}
          </>
        ) : (
          <>
            <Field label="Delivery address" value={location} onChangeText={setLocation} placeholder="Enter your delivery address" />
            <Text style={styles.fieldLabel}>Delivery date</Text>
            <View style={styles.ratingChoices}>
              {deliveryDateOptions.map((option) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: deliveryDate === option.value }}
                  key={option.value}
                  onPress={() => setDeliveryDate(option.value)}
                  style={[styles.issueTypeChoice, deliveryDate === option.value && styles.issueTypeChoiceSelected]}
                >
                  <Text style={[styles.issueTypeChoiceText, deliveryDate === option.value && styles.issueTypeChoiceTextSelected]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Delivery time window</Text>
            <View style={styles.ratingChoices}>
              {([
                ['morning', '8am–12pm'],
                ['afternoon', '12pm–4pm'],
                ['evening', '4pm–8pm'],
              ] as const).map(([value, label]) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: deliverySlot === value }}
                  key={value}
                  onPress={() => setDeliverySlot(value)}
                  style={[styles.issueTypeChoice, deliverySlot === value && styles.issueTypeChoiceSelected]}
                >
                  <Text style={[styles.issueTypeChoiceText, deliverySlot === value && styles.issueTypeChoiceTextSelected]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.featureCard}>
              <Text style={styles.productName}>Seller promo code</Text>
              <Text style={styles.productStore}>10% off eligible products from the participating store. Delivery and service fees are not discounted.</Text>
              <Field label="Promo code" value={promoCode} onChangeText={(value) => { setPromoCode(value.toUpperCase()); setPromoDiscount(0); setPromoMessage(''); }} placeholder="Enter code" />
              <SecondaryButton label={isApplyingPromo ? 'Checking code…' : 'Apply promo'} disabled={isApplyingPromo} onPress={() => void applyPromoCode()} />
              {promoMessage ? <Text style={promoDiscount > 0 ? styles.dashboardNotice : styles.authError}>{promoMessage}</Text> : null}
            </View>
            <Text style={styles.fieldLabel}>Payment method</Text>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: !usePaymentSimulator && paymentMethod === 'bank_transfer' }} onPress={() => { setUsePaymentSimulator(false); setPaymentMethod('bank_transfer'); }} style={[styles.paymentOption, !usePaymentSimulator && paymentMethod === 'bank_transfer' && styles.selectedPayment]}>
              <Ionicons color="#143A73" name="swap-horizontal-outline" size={23} style={styles.paymentIcon} />
              <View style={styles.productCopy}><Text style={styles.productName}>Bank transfer</Text><Text style={styles.productStore}>Monnify · Sandbox test</Text></View>
              {!usePaymentSimulator && paymentMethod === 'bank_transfer' ? <Ionicons color="#143A73" name="checkmark-circle" size={22} /> : <View style={styles.paymentRadioEmpty} />}
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: !usePaymentSimulator && paymentMethod === 'card' }} onPress={() => { setUsePaymentSimulator(false); setPaymentMethod('card'); }} style={[styles.paymentOption, !usePaymentSimulator && paymentMethod === 'card' && styles.selectedPayment]}>
              <Ionicons color="#143A73" name="card-outline" size={23} style={styles.paymentIcon} />
              <View style={styles.productCopy}><Text style={styles.productName}>Card payment</Text><Text style={styles.productStore}>Monnify · Sandbox test</Text></View>
              {!usePaymentSimulator && paymentMethod === 'card' ? <Ionicons color="#143A73" name="checkmark-circle" size={22} /> : <View style={styles.paymentRadioEmpty} />}
            </Pressable>
            {PAYMENT_SIMULATOR_AVAILABLE ? (
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: usePaymentSimulator }} onPress={() => setUsePaymentSimulator(true)} style={[styles.paymentOption, usePaymentSimulator && styles.selectedPayment]}>
                <Ionicons color="#143A73" name="flask-outline" size={23} style={styles.paymentIcon} />
                <View style={styles.productCopy}><Text style={styles.productName}>Test payment simulation</Text><Text style={styles.productStore}>Developer mode · choose success or failure after placing the test order</Text></View>
                {usePaymentSimulator ? <Ionicons color="#143A73" name="checkmark-circle" size={22} /> : <View style={styles.paymentRadioEmpty} />}
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: !usePaymentSimulator && paymentMethod === 'cash_on_delivery' }} onPress={() => { setUsePaymentSimulator(false); setPaymentMethod('cash_on_delivery'); }} style={[styles.paymentOption, !usePaymentSimulator && paymentMethod === 'cash_on_delivery' && styles.selectedPayment]}>
              <Ionicons color="#143A73" name="cash-outline" size={23} style={styles.paymentIcon} />
              <View style={styles.productCopy}><Text style={styles.productName}>Cash on delivery</Text><Text style={styles.productStore}>Pay the rider in cash when your order arrives</Text></View>
              {!usePaymentSimulator && paymentMethod === 'cash_on_delivery' ? <Ionicons color="#143A73" name="checkmark-circle" size={22} /> : <View style={styles.paymentRadioEmpty} />}
            </Pressable>
            <View style={styles.checkoutCostCard}>
              <Text style={styles.checkoutCostTitle}>Order summary</Text>
              <View style={styles.checkoutCostRow}>
                <Text style={styles.checkoutCostLabel}>Items subtotal</Text>
                <Text style={styles.checkoutCostValue}>{formatCurrency(checkoutSubtotal)}</Text>
              </View>
              <View style={styles.checkoutCostRow}>
                <View style={styles.checkoutFeeCopy}>
                  <Text style={styles.checkoutCostLabel}>Delivery fee</Text>
                  <Text style={styles.checkoutFeeHint}>{isKubwaDeliveryAddress(location) ? 'Kubwa rate' : 'Other locations'}</Text>
                </View>
                <Text style={styles.checkoutCostValue}>{formatCurrency(deliveryFee)}</Text>
              </View>
              <View style={styles.checkoutCostRow}>
                <Text style={styles.checkoutCostLabel}>Service fee</Text>
                <Text style={styles.checkoutCostValue}>{formatCurrency(bookingFee)}</Text>
              </View>
              <View style={styles.checkoutCostRow}>
                <Text style={styles.checkoutCostLabel}>Road development levy</Text>
                <Text style={styles.checkoutCostValue}>{formatCurrency(roadDevelopmentLevy)}</Text>
              </View>
              {promoDiscount > 0 ? (
                <View style={styles.checkoutCostRow}>
                  <Text style={styles.checkoutCostLabel}>Seller promo discount</Text>
                  <Text style={styles.checkoutCostValue}>−{formatCurrency(promoDiscount)}</Text>
                </View>
              ) : null}
              <View style={[styles.checkoutCostRow, styles.checkoutGrandTotal]}>
                <Text style={styles.checkoutGrandTotalLabel}>Total</Text>
                <Text style={styles.checkoutGrandTotalValue}>{formatCurrency(checkoutTotal)}</Text>
              </View>
              <Text style={styles.checkoutFeeHint}>Seller-funded promo discounts apply only to eligible product sales. Delivery and service fees are charged separately.</Text>
            </View>
            {usePaymentSimulator ? (
              <View style={styles.paymentSetupNotice}>
                <Ionicons color="#8A5A10" name="flask-outline" size={20} />
                <Text style={styles.paymentSetupNoticeText}>Developer-only simulation. No money moves, simulated orders never generate seller or rider payouts, and this does not contact Monnify.</Text>
              </View>
            ) : paymentMethod === 'cash_on_delivery' ? (
              <View style={styles.paymentSetupNotice}>
                <Ionicons color="#2D8A59" name="information-circle-outline" size={20} />
                <Text style={styles.paymentSetupNoticeText}>Pay {formatCurrency(checkoutTotal)} in cash to the delivery rider when your order arrives.</Text>
              </View>
            ) : (
              <View style={styles.paymentSetupNotice}>
                <Ionicons color="#8A5A10" name="information-circle-outline" size={20} />
                <Text style={styles.paymentSetupNoticeText}>Sandbox payments only. Seller and rider payouts remain on hold until you confirm delivery.</Text>
              </View>
            )}
            <PrimaryButton
              label={usePaymentSimulator
                ? isSubmittingOrder ? 'Creating test order…' : `Create test order · ${formatCurrency(checkoutTotal)}`
                : paymentMethod === 'cash_on_delivery'
                ? isSubmittingOrder ? 'Placing order...' : `Place order · ${formatCurrency(checkoutTotal)}`
                : isSubmittingOrder ? 'Opening Monnify…' : `Pay with Monnify · ${formatCurrency(checkoutTotal)}`}
              disabled={isSubmittingOrder || !location.trim() || !selectedCartLines.length}
              onPress={confirmOrder}
            />
            {!location.trim() ? <Text style={styles.formHint}>Add a delivery address to prepare your order.</Text> : null}
            {authError ? <Text style={styles.authError}>{authError}</Text> : null}
          </>
        )}
      </FormShell>
    );
  }

  if (screen === 'orderChat') {
    return (
      <Shell toast={toast}>
        <View style={styles.profileTopBar}>
          <BackButton onPress={() => setScreen(chatReturnScreen)} />
          <Text style={styles.pageTitleLeft}>Order chat</Text>
          <View />
        </View>
        <Text style={styles.pageDescriptionLeft}>Order #{chatOrderId.slice(0, 8).toUpperCase()} · Messages are visible only to this order’s buyer and seller.</Text>
        {chatError ? <Text style={styles.authError}>{chatError}</Text> : null}
        {isLoadingChat ? <Text style={styles.emptyText}>Loading messages…</Text> : null}
        {!isLoadingChat && chatMessages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}><Ionicons color="#1B4D8F" name="chatbubbles-outline" size={40} /></View>
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyText}>Ask about this order or coordinate with the seller.</Text>
          </View>
        ) : chatMessages.map((message) => (
          <View
            key={message.id}
            style={[
              styles.featureCard,
              { alignSelf: message.sender_id === currentUserId ? 'flex-end' : 'flex-start', maxWidth: '90%' },
            ]}
          >
            <Text style={styles.productStore}>{message.sender_id === currentUserId ? 'You' : role === 'seller' ? 'Buyer' : 'Seller'}</Text>
            <Text style={styles.productName}>{message.message}</Text>
            <Text style={styles.notificationTime}>{new Date(message.created_at).toLocaleString()}</Text>
          </View>
        ))}
        <TextInput
          accessibilityLabel="Chat message"
          editable={!isSendingChat}
          maxLength={2000}
          multiline
          onChangeText={setChatDraft}
          placeholder="Write a message…"
          placeholderTextColor="#8B9DB2"
          style={[styles.input, styles.multilineInput]}
          value={chatDraft}
        />
        <PrimaryButton
          label={isSendingChat ? 'Sending…' : 'Send message'}
          disabled={isSendingChat || !chatDraft.trim() || !chatThreadId}
          onPress={() => void sendChatMessage()}
        />
      </Shell>
    );
  }

  if (screen === 'saved') {
    return (
      <Shell>
        <BackButton onPress={() => setScreen('dashboard')} />
        <Text style={styles.pageTitleLeft}>Saved products</Text>
        <Text style={styles.pageDescriptionLeft}>Keep track of products you want to buy later.</Text>
        {saved.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}><Ionicons color="#1B4D8F" name="heart-outline" size={46} /></View>
            <Text style={styles.emptyTitle}>Nothing saved yet</Text>
            <Text style={styles.emptyText}>Tap the heart on a product to save it here.</Text>
            <PrimaryButton label="Browse products" onPress={() => setScreen('dashboard')} />
          </View>
        ) : saved.map((product) => (
          <View key={product.id ?? product.name} style={styles.productCard}>
            <Pressable onPress={() => openProductDetail(product, 'saved')} style={styles.productImage}><Ionicons color="#5C7FA9" name="leaf-outline" size={30} /></Pressable>
            <View style={styles.productCopy}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productStore}>{product.store}</Text><Text style={styles.productPrice}>{product.price}</Text></View>
            <Pressable accessibilityLabel={product.isAvailable === false ? 'Product unavailable' : 'Add product to cart'} accessibilityRole="button" disabled={product.isAvailable === false} onPress={() => addToCart(product)} style={[styles.addButton, product.isAvailable === false && styles.addButtonDisabled]}><Ionicons color={product.isAvailable === false ? '#A8B5C4' : '#D5F0FF'} name={product.isAvailable === false ? 'remove' : 'add'} size={23} /></Pressable>
            <Pressable accessibilityLabel="Remove from saved products" accessibilityRole="button" onPress={() => toggleSavedProduct(product)} style={styles.saveButton}><Ionicons color="#143A73" name="heart" size={21} /></Pressable>
          </View>
        ))}
      </Shell>
    );
  }

  if (screen === 'orders') {
    return (
      <Shell toast={toast}>
        <BackButton onPress={goBack} />
        <Text style={styles.pageTitleLeft}>{role === 'admin' ? 'Marketplace orders' : 'Your orders'}</Text>
        <Text style={styles.pageDescriptionLeft}>{role === 'admin' ? 'Orders currently visible to your administrator account.' : 'Track orders placed from your account.'}</Text>
        {ordersError ? <Text style={styles.authError}>{ordersError}</Text> : null}
        {isLoadingOrders ? <Text style={styles.emptyText}>Loading orders…</Text> : null}
        {orders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}><Ionicons color="#1B4D8F" name="receipt-outline" size={46} /></View>
            <Text style={styles.emptyTitle}>{isLoadingOrders ? 'Loading orders' : 'No orders yet'}</Text>
            {!isLoadingOrders ? <Text style={styles.emptyText}>Orders placed from this account will appear here.</Text> : null}
            {role === 'buyer' ? <PrimaryButton label="Start shopping" onPress={() => setScreen('dashboard')} /> : null}
          </View>
        ) : (
          <>
            {orders.map((order) => (
              <View key={order.id}>
                <Pressable onPress={() => { setPaymentCheckMessage(''); setSelectedOrder(order); setScreen('tracking'); }} style={styles.cartRow}>
                  <View style={styles.productCopy}>
                    <Text style={styles.productName}>Order #{order.id.slice(0, 6)}</Text>
                    <Text style={styles.productStore}>{order.items.length} items • {formatCurrency(order.total)}</Text>
                    <Text style={styles.productStore}>{order.deliveryAddress}</Text>
                    <Text style={styles.productStore}>Delivery · {order.deliveryDate} · {getDeliveryWindowLabel(order.deliverySlot)}</Text>
                    {order.promoCode ? <Text style={styles.productStore}>Promo {order.promoCode} · −{formatCurrency(order.promoDiscount)}</Text> : null}
                    {order.paymentMethod === 'monnify' ? <Text style={styles.productStore}>{order.paymentSimulated ? 'Test simulation' : 'Monnify payment'} · {order.paymentStatus.replace('_', ' ')}</Text> : null}
                    {refundRequests.find((refund) => refund.order_id === order.dbId) ? <Text style={styles.productStore}>Refund · {refundRequests.find((refund) => refund.order_id === order.dbId)?.status.replace('_', ' ')}</Text> : null}
                    {cancellationRequests.find((request) => request.order_id === order.dbId && request.status === 'pending') ? <Text style={styles.productStore}>Cancellation request · awaiting admin review</Text> : null}
                    {order.buyerConfirmedAt ? <Text style={styles.productStore}>Delivery receipt confirmed</Text> : null}
                  </View>
                  <Text style={styles.statusText}>{order.status.replace('_', ' ')}</Text>
                </Pressable>
                {role === 'buyer' ? (
                  [...new Map(order.items.filter((item) => item.storeId).map((item) => [item.storeId!, item.store])).entries()].map(([storeId, storeName]) => (
                    <SecondaryButton key={`${order.dbId}-${storeId}`} label={`Chat with ${storeName}`} onPress={() => void openOrderChat(order.dbId, storeId)} />
                  ))
                ) : null}
                {role === 'buyer' ? <SecondaryButton label="Reorder these items" onPress={() => void reorderOrder(order)} /> : null}
              </View>
            ))}
            {role === 'buyer' ? <PrimaryButton label="Continue shopping" onPress={() => setScreen('dashboard')} /> : null}
          </>
        )}
      </Shell>
    );
  }

  if (screen === 'tracking' && selectedOrder) {
    return (
      <Shell toast={toast}>
        <BackButton onPress={() => setScreen('orders')} />
        <Text style={styles.pageTitleLeft}>Track your order</Text>
        <Text style={styles.pageDescriptionLeft}>Order #{selectedOrder.id.slice(0, 6)} · {selectedOrder.status.replace('_', ' ')}</Text>
        <View style={styles.featureCard}>
          <Text style={styles.productName}>Delivery · {selectedOrder.deliveryDate} · {getDeliveryWindowLabel(selectedOrder.deliverySlot)}</Text>
          {selectedOrder.promoCode ? <Text style={styles.productStore}>Promo {selectedOrder.promoCode} · {formatCurrency(selectedOrder.promoDiscount)} off</Text> : null}
          {[...new Map(selectedOrder.items.filter((item) => item.storeId).map((item) => [item.storeId!, item.store])).entries()].map(([storeId, storeName]) => (
            <SecondaryButton key={`${selectedOrder.dbId}-${storeId}`} label={`Chat with ${storeName}`} onPress={() => void openOrderChat(selectedOrder.dbId, storeId)} />
          ))}
          {role === 'buyer' && selectedOrder.status === 'out_for_delivery' ? (
            <SecondaryButton label={isCallingRider ? 'Opening phone…' : 'Call assigned rider'} disabled={isCallingRider} onPress={() => void callAssignedRider(selectedOrder)} />
          ) : null}
        </View>
        <View style={styles.trackingCard}>
          <View style={styles.productCopy}>
            {selectedOrder.items.map((item) => (
              <View key={`${item.orderItemId || item.id}-${item.name}`} style={styles.substitutionOfferCard}>
                <Text style={styles.productName}>{item.quantity} × {item.name}</Text>
                {item.substitutionOffer ? (
                  item.substitutionOffer.status === 'pending' ? (
                    <View style={styles.substitutionBuyerOffer}>
                      <Text style={styles.substitutionOfferText}>Seller suggests {item.substitutionOffer.product.name} at the same price.</Text>
                      <View style={styles.substitutionResponseRow}>
                        <Pressable accessibilityRole="button" onPress={() => void respondToSubstitution(selectedOrder, item, true)} style={styles.substitutionAcceptButton}>
                          <Text style={styles.substitutionAcceptText}>Accept</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" onPress={() => void respondToSubstitution(selectedOrder, item, false)} style={styles.substitutionDeclineButton}>
                          <Text style={styles.substitutionDeclineText}>Decline</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : item.substitutionOffer.status === 'accepted'
                    ? <Text style={styles.substitutionOfferText}>Replacement approved: {item.name}</Text>
                    : <Text style={styles.substitutionOfferText}>You declined the suggested replacement.</Text>
                ) : null}
              </View>
            ))}
            <Text style={styles.productStore}>Total {formatCurrency(selectedOrder.total)}</Text>
          </View>
          <Text style={styles.statusText}>{selectedOrder.status.replace('_', ' ')}</Text>
        </View>
        <View style={styles.timeline}>
          <TimelineStep title="Order placed" detail="Order received" complete />
          <TimelineStep title="Accepted / preparing" detail="Seller is processing your order" complete={['accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'].includes(selectedOrder.status)} />
          <TimelineStep title="Ready / out for delivery" detail="Ready for handover or on its way" complete={['ready', 'out_for_delivery', 'completed'].includes(selectedOrder.status)} />
          <TimelineStep title="Completed" detail={selectedOrder.status === 'completed' ? 'Order completed' : 'Not completed yet'} complete={selectedOrder.status === 'completed'} />
        </View>
        <View style={styles.deliveryAddress}>
          <Text style={styles.profileLabel}>Delivering to</Text>
          <Text style={styles.profileValue}>{selectedOrder.deliveryAddress}</Text>
        </View>
        <View style={styles.deliveryAddress}>
          <Text style={styles.profileLabel}>Payment</Text>
          <Text style={styles.profileValue}>{selectedOrder.paymentMethod === 'monnify'
            ? `${selectedOrder.paymentSimulated ? 'Test simulation' : 'Monnify'} · ${selectedOrder.paymentStatus.replace('_', ' ')}`
            : 'Cash on delivery'}</Text>
        </View>
        {selectedOrder.deliveryProofUrl ? (
          <View style={styles.deliveryAddress}>
            <Text style={styles.profileLabel}>Delivery photo proof</Text>
            <Image accessibilityLabel="Photo proof of delivery" source={{ uri: selectedOrder.deliveryProofUrl }} style={styles.deliveryProofImage} />
          </View>
        ) : selectedOrder.status === 'completed' ? (
          <Text style={styles.deliveryEmptyText}>No delivery photo was attached to this order.</Text>
        ) : null}
        {selectedOrder.paymentSimulated && selectedOrder.paymentStatus === 'pending' ? (
          <View>
            <Text style={styles.deliveryEmptyText}>Test mode only—these buttons do not move money or contact Monnify.</Text>
            <PrimaryButton label={isCheckingPayment ? 'Recording test result…' : 'Simulate successful payment'} disabled={isCheckingPayment} onPress={() => void recordPaymentSimulation(selectedOrder, 'success')} />
            <SecondaryButton label="Simulate unsuccessful payment" disabled={isCheckingPayment} onPress={() => void recordPaymentSimulation(selectedOrder, 'failure')} />
          </View>
        ) : null}
        {selectedOrder.paymentMethod === 'monnify' && !selectedOrder.paymentSimulated && selectedOrder.paymentStatus !== 'paid' ? (
          <>
            <Text style={styles.deliveryEmptyText}>Payment is not verified yet. The seller and rider cannot begin this order until Monnify confirms it.</Text>
            <SecondaryButton label={isCheckingPayment ? 'Checking payment…' : 'Check Monnify payment'} disabled={isCheckingPayment} onPress={() => void checkMonnifyPayment(selectedOrder)} />
          </>
        ) : null}
        {paymentCheckMessage ? <Text style={styles.deliveryEmptyText}>{paymentCheckMessage}</Text> : null}
        {role === 'buyer' && ['pending', 'accepted', 'preparing'].includes(selectedOrder.status) ? (
          <View style={styles.featureCard}>
            <Text style={styles.productName}>Need to cancel this order?</Text>
            <Text style={styles.productStore}>Orders cancel automatically before seller acceptance. Later requests are reviewed by GetBuy support.</Text>
            {cancellationRequests.some((request) => request.order_id === selectedOrder.dbId && request.status === 'pending') ? (
              <Text style={styles.dashboardNotice}>Your cancellation request is awaiting admin review.</Text>
            ) : (
              <>
                <Field
                  label="Reason for cancellation"
                  value={cancellationReasons[selectedOrder.id] || ''}
                  onChangeText={(value) => setCancellationReasons((current) => ({ ...current, [selectedOrder.id]: value }))}
                  placeholder="Tell us why you need to cancel"
                />
                <SecondaryButton label="Request cancellation" onPress={() => void requestOrderCancellation(selectedOrder)} />
              </>
            )}
          </View>
        ) : null}
        {refundRequests.find((refund) => refund.order_id === selectedOrder.dbId) ? (
          <View style={styles.featureCard}>
            <Text style={styles.productName}>Refund status · {refundRequests.find((refund) => refund.order_id === selectedOrder.dbId)?.status.replace('_', ' ')}</Text>
            <Text style={styles.productStore}>{refundRequests.find((refund) => refund.order_id === selectedOrder.dbId)?.admin_note || 'Online refunds are processed manually by GetBuy support.'}</Text>
          </View>
        ) : null}
        {cancellationRequests.find((request) => request.order_id === selectedOrder.dbId && request.status !== 'pending') ? (
          <View style={styles.featureCard}>
            <Text style={styles.productName}>Cancellation · {cancellationRequests.find((request) => request.order_id === selectedOrder.dbId && request.status !== 'pending')?.status}</Text>
            <Text style={styles.productStore}>{cancellationRequests.find((request) => request.order_id === selectedOrder.dbId && request.status !== 'pending')?.admin_note || 'Your order cancellation request has been reviewed.'}</Text>
          </View>
        ) : null}
        {dashboardNotice ? <Text style={styles.dashboardNotice}>{dashboardNotice}</Text> : null}
        {selectedOrder.status === 'completed' && !selectedOrder.buyerConfirmedAt
          && (selectedOrder.paymentMethod !== 'monnify' || selectedOrder.paymentStatus === 'paid') ? (
          <PrimaryButton label={isConfirmingReceived ? 'Confirming…' : 'Confirm I received this order'} disabled={isConfirmingReceived} onPress={() => void confirmOrderReceived(selectedOrder)} />
        ) : null}
        {selectedOrder.buyerConfirmedAt ? <Text style={styles.dashboardNotice}>Receipt confirmed. Seller and rider payouts can now be processed.</Text> : null}
        {role === 'buyer' && selectedOrder.status === 'completed' && selectedOrder.buyerConfirmedAt ? (
          <View style={styles.orderFeatureSection}>
            <Text style={styles.dashboardSectionTitle}>Rate your stores</Text>
            {[...new Map(selectedOrder.items.filter((item) => item.storeId).map((item) => [item.storeId!, item.store])).entries()].map(([storeId, storeName]) => {
              const savedReview = selectedOrder.reviews.find((review) => review.storeId === storeId);
              const key = `${selectedOrder.id}:${storeId}`;
              const draft = reviewDrafts[key] || { rating: savedReview?.rating || 5, review: savedReview?.review || '' };
              return (
                <View key={storeId} style={styles.featureCard}>
                  <Text style={styles.productName}>{storeName}</Text>
                  <View style={styles.ratingChoices}>
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <Pressable
                        accessibilityLabel={`Rate ${rating} out of 5`}
                        accessibilityRole="button"
                        key={rating}
                        onPress={() => setReviewDrafts((current) => ({ ...current, [key]: { ...draft, rating } }))}
                        style={[styles.ratingChoice, rating <= draft.rating && styles.ratingChoiceSelected]}
                      >
                        <Text style={[styles.ratingChoiceText, rating <= draft.rating && styles.ratingChoiceTextSelected]}>★</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Field
                    label="Review (optional)"
                    value={draft.review}
                    onChangeText={(review) => setReviewDrafts((current) => ({ ...current, [key]: { ...draft, review } }))}
                    placeholder="Share a few words about this store"
                    multiline
                  />
                  <PrimaryButton
                    label={submittingReviewKey === key ? 'Saving review…' : savedReview ? 'Update review' : 'Submit review'}
                    disabled={Boolean(submittingReviewKey)}
                    onPress={() => void submitStoreReview(selectedOrder, storeId)}
                  />
                </View>
              );
            })}
          </View>
        ) : null}
        {role === 'buyer' ? (
          <View style={styles.orderFeatureSection}>
            <Text style={styles.dashboardSectionTitle}>Order issue reports</Text>
            {selectedOrder.issues.map((issue) => (
              <View key={issue.id} style={styles.featureCard}>
                <Text style={styles.productName}>{issue.issueType.replaceAll('_', ' ')} · {issue.status.replaceAll('_', ' ')}</Text>
                <Text style={styles.productStore}>{issue.description}</Text>
                {issue.adminNote ? <Text style={styles.dashboardNotice}>Support: {issue.adminNote}</Text> : null}
              </View>
            ))}
            {selectedOrder.status !== 'cancelled' ? (
              <View style={styles.featureCard}>
                <Text style={styles.productStore}>Tell GetBuy support what went wrong with this order.</Text>
                <View style={styles.issueTypeChoices}>
                  {[
                    ['missing_item', 'Missing item'],
                    ['damaged_item', 'Damaged'],
                    ['late_delivery', 'Late delivery'],
                    ['payment', 'Payment'],
                    ['other', 'Other'],
                  ].map(([value, label]) => (
                    <Pressable
                      accessibilityRole="button"
                      key={value}
                      onPress={() => setIssueType(value)}
                      style={[styles.issueTypeChoice, issueType === value && styles.issueTypeChoiceSelected]}
                    >
                      <Text style={[styles.issueTypeChoiceText, issueType === value && styles.issueTypeChoiceTextSelected]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Field label="Details" value={issueDescription} onChangeText={setIssueDescription} placeholder="Describe the issue (at least 5 characters)" multiline />
                <PrimaryButton
                  label={isSubmittingIssue ? 'Sending report…' : 'Send issue report'}
                  disabled={isSubmittingIssue || issueDescription.trim().length < 5}
                  onPress={() => void submitOrderIssue(selectedOrder)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {authError ? <Text style={styles.authError}>{authError}</Text> : null}
        {selectedOrder.status === 'out_for_delivery' ? (
          <View style={styles.riderMapCard}>
            <Text style={styles.deliveryCheckTitle}>Live rider location</Text>
            {riderLocation ? (
              <>
                <RiderMap location={riderLocation} />
                <Text style={styles.riderMapUpdated}>Updated {new Date(riderLocation.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              </>
            ) : (
              <Text style={styles.deliveryEmptyText}>Waiting for the rider’s first location update. The map will appear when location sharing is available.</Text>
            )}
            <Text style={styles.riderMapPrivacy}>Rider location is shared only during an active assigned delivery. Map tiles by OpenStreetMap.</Text>
          </View>
        ) : null}
        <SecondaryButton label="Contact support" onPress={() => setScreen('support')} />
      </Shell>
    );
  }

  if (screen === 'support') {
    return (
      <Shell>
        <BackButton onPress={() => setScreen('tracking')} />
        <Text style={styles.pageTitleLeft}>How can we help?</Text>
        <Text style={styles.pageDescriptionLeft}>Find order guidance or email the GetBuy support team.</Text>
        <View style={styles.supportOptions}>
          <Pressable accessibilityRole="link" onPress={contactSupport} style={styles.supportOption}>
            <View style={styles.supportIcon}><Ionicons color="#143A73" name="mail-outline" size={19} /></View>
            <View style={styles.productCopy}>
              <Text style={styles.productName}>Email GetBuy support</Text>
              <Text style={styles.productStore}>{SUPPORT_EMAIL}</Text>
            </View>
            <Ionicons color="#143A73" name="arrow-forward" size={19} />
          </Pressable>
        </View>
        <Text style={styles.dashboardSectionTitle}>Popular questions</Text>
        {['Where is my order?', 'How do I change my delivery address?', 'What is the refund policy?'].map((question) => (
          <View key={question}>
            <Pressable onPress={() => setExpandedSupportQuestion(expandedSupportQuestion === question ? null : question)} style={styles.questionRow}>
              <Text style={styles.questionText}>{question}</Text>
              <Ionicons color="#143A73" name={expandedSupportQuestion === question ? 'remove' : 'add'} size={21} />
            </Pressable>
            {expandedSupportQuestion === question ? (
              <Text style={styles.orderSummaryText}>
                {question === 'Where is my order?'
                  ? 'Open Orders from the marketplace menu to see the latest status provided by the seller or delivery partner.'
                  : question === 'How do I change my delivery address?'
                    ? 'Update your saved address in your profile before placing an order. An address on an existing order cannot be changed in the app.'
                    : 'Refund handling is not configured in this app. Contact the marketplace owner for refund assistance.'}
              </Text>
            ) : null}
          </View>
        ))}
      </Shell>
    );
  }

  return (
    <Shell>
      <BackButton onPress={goBack} />
      <View style={styles.centerContent}>
        <View style={styles.successMark}><Ionicons color="#143A73" name="checkmark" size={42} /></View>
        <Text style={styles.pageTitle}>You’re ready to go</Text>
        <Text style={styles.pageDescription}>Your getBuy account has been set up successfully.</Text>
        <PrimaryButton
          label={role === 'buyer' ? 'Browse marketplace' : role === 'seller' ? 'View store dashboard' : role === 'delivery' ? 'View delivery dashboard' : 'Continue'}
          onPress={() => setScreen(role === 'buyer' ? 'dashboard' : role === 'seller' ? 'sellerDashboard' : role === 'delivery' ? 'deliveryDashboard' : 'adminSetup')}
        />
      </View>
    </Shell>
  );
}

function Shell({ children, footer, toast }: { children: React.ReactNode; footer?: React.ReactNode; toast?: string }) {
  const entrance = useRef(new Animated.Value(0)).current;
  const navigation = useSyncExternalStore(subscribeToAppNavigation, getAppNavigationSnapshot, getAppNavigationSnapshot);

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const tabs = navigation && navigation.role && navigation.role !== 'admin' && !screensWithoutNavigation.includes(navigation.screen)
    ? getNavigationTabs(navigation)
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoidingView}
      >
        <Animated.View
          style={[
            styles.screenTransition,
            {
              opacity: entrance,
              transform: [{
                translateX: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [Platform.OS === 'ios' ? 18 : 8, 0],
                }),
              }],
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            {children}
          </ScrollView>
          {toast ? (
            <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.toast}>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
          {tabs && navigation ? (
            <View accessibilityRole="tablist" style={styles.bottomNavigation}>
              {tabs.map((tab) => (
                <Pressable
                  accessibilityLabel={tab.label === 'Cart' && navigation.cartCount > 0 ? `${tab.label}, ${navigation.cartCount} items` : tab.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab.active }}
                  key={tab.label}
                  onPress={() => navigation.navigate(tab.destination)}
                  style={styles.bottomNavigationItem}
                >
                  <View style={styles.bottomNavigationIconWrap}>
                    <Ionicons color={tab.active ? '#0F3D6E' : '#71839A'} name={tab.icon} size={21} />
                    {tab.destination === 'cart' && navigation.cartCount > 0 ? (
                      <View style={styles.bottomNavigationBadge}>
                        <Text style={styles.bottomNavigationBadgeText}>{navigation.cartCount > 9 ? '9+' : navigation.cartCount}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.bottomNavigationLabel, tab.active && styles.bottomNavigationLabelActive]}>{tab.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : footer}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function FormShell({ title, description, onBack, children, hideHeader = false }: { title: string; description: string; onBack: () => void; children: React.ReactNode; hideHeader?: boolean }) {
  return (
    <Shell>
      {!hideHeader && <BackButton onPress={onBack} />}
      {!hideHeader && <View style={styles.formHeader}><Text style={styles.pageTitle}>{title}</Text><Text style={styles.pageDescription}>{description}</Text></View>}
      <View style={styles.form}>{children}</View>
    </Shell>
  );
}

function BrandMark() {
  return <View style={styles.brandMark}><BoxMark /><Text style={styles.brandMarkText}>getBuy</Text></View>;
}

function BoxMark({ green = false, light = false }: { green?: boolean; light?: boolean }) {
  return (
    <View style={styles.boxMark}>
      <View style={[styles.boxTopLeft, light && styles.boxLight, green && styles.boxGreen]} />
      <View style={[styles.boxTopRight, light && styles.boxLight, green && styles.boxGreen]} />
      <View style={[styles.boxBottomLeft, light && styles.boxLight, green && styles.boxGreen]} />
      <View style={[styles.boxBottomRight, light && styles.boxLight, green && styles.boxGreen]} />
    </View>
  );
}

function LogoLockup({ light = false, green = false, compact = false }: { light?: boolean; green?: boolean; compact?: boolean }) {
  return <View style={styles.logoLockup}><BoxMark green={green} light={light} /><Text style={[styles.logoWordmark, light && styles.logoWordmarkLight, green && styles.logoWordmarkGreen, compact && styles.logoWordmarkCompact]}>getBuy</Text></View>;
}

function SplashScreen() {
  return (
    <SafeAreaView style={styles.splash} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.splashContent}>
        <LogoLockup light />
        <Text style={styles.splashTagline}>Fresh from your neighbourhood.</Text>
      </View>
    </SafeAreaView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={onPress} style={styles.backButton}><Ionicons color="#1D4E89" name="arrow-back" size={25} /></Pressable>;
}

function RoleCard({ icon, title, description, selected, onPress }: { icon: string; title: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.roleCard, selected && styles.selectedCard, pressed && styles.pressedCard]}><View style={styles.iconCircle}><Text style={styles.iconText}>{icon}</Text></View><View style={styles.roleCopy}><Text style={styles.roleTitle}>{title}</Text><Text style={styles.roleDescription}>{description}</Text></View><View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View></Pressable>;
}

function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.pressedButton]}><Text style={styles.primaryText}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.pressedButton]}><Text style={styles.secondaryText}>{label}</Text></Pressable>;
}

function NotificationButton({ unreadCount, onPress }: { unreadCount: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.notificationButton}
    >
      <Ionicons color="#143A73" name="notifications-outline" size={23} />
      {unreadCount > 0 ? (
        <View style={styles.notificationBadge}>
          <Text style={styles.notificationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; secureTextEntry?: boolean; keyboardType?: 'email-address' | 'decimal-pad' | 'numeric' | 'phone-pad' | 'default'; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput autoCapitalize="none" keyboardType={keyboardType} multiline={multiline} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#8B9DB2" secureTextEntry={secureTextEntry} style={[styles.input, multiline && styles.multilineInput]} value={value} /></View>;
}

function Terms({ onOpen }: { onOpen: () => void }) {
  return (
    <Text style={styles.terms}>
      By continuing, you agree to our{' '}
      <Text accessibilityRole="link" onPress={onOpen} style={styles.termsLink}>Terms and Conditions</Text>.
    </Text>
  );
}

function BuyerTabBar({ active, cartCount, savedCount, orderCount, onNavigate }: { active: string; cartCount: number; savedCount: number; orderCount: number; onNavigate: (screen: Screen) => void }) {
  const tabs = [
    { key: 'home', label: 'Home', icon: 'home-outline', screen: 'dashboard' as Screen },
    { key: 'saved', label: `Saved${savedCount ? ` (${savedCount})` : ''}`, icon: 'heart-outline', screen: 'saved' as Screen },
    { key: 'cart', label: `Cart${cartCount ? ` (${cartCount})` : ''}`, icon: 'cart-outline', screen: 'cart' as Screen },
    { key: 'orders', label: `Orders${orderCount ? ` (${orderCount})` : ''}`, icon: 'receipt-outline', screen: 'orders' as Screen },
    { key: 'profile', label: 'Profile', icon: 'person-outline', screen: 'profile' as Screen },
  ] as const;

  return (
    <View style={styles.iosTabBar}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.key }}
          onPress={() => onNavigate(tab.screen)}
          style={({ pressed }) => [styles.iosTab, pressed && styles.pressedButton]}
        >
          <Ionicons color={active === tab.key ? '#143A73' : '#7D91A8'} name={tab.icon} size={20} />
          <Text style={[styles.iosTabLabel, active === tab.key && styles.iosTabActive]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function TimelineStep({ title, detail, complete = false }: { title: string; detail: string; complete?: boolean }) {
  return <View style={styles.timelineStep}><View style={[styles.timelineDot, complete && styles.timelineDotComplete]}>{complete ? <Ionicons color="#FFF" name="checkmark" size={15} /> : null}</View><View><Text style={styles.productName}>{title}</Text><Text style={styles.productStore}>{detail}</Text></View></View>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#EAF3FF', flex: 1 },
  loadingState: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  loadingText: { color: '#536A86', fontSize: 14, marginTop: 16 },
  keyboardAvoidingView: { flex: 1 },
  screenTransition: { flex: 1 },
  container: { backgroundColor: '#EAF3FF', flexGrow: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 28 },
  splash: { backgroundColor: '#143A73', flex: 1 },
  splashContent: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  splashTagline: { color: '#C9E5FF', fontSize: 16, marginTop: 16 },
  logoLockup: { alignItems: 'center', flexDirection: 'row' },
  logoWordmark: { color: '#143A73', fontSize: 42, fontWeight: '800', letterSpacing: -2 },
  logoWordmarkCompact: { fontSize: 30, letterSpacing: -1.2 },
  logoWordmarkLight: { color: '#FFF' },
  logoWordmarkGreen: { color: '#143A73' },
  boxMark: { height: 44, marginRight: 10, position: 'relative', width: 46 },
  boxTopLeft: { backgroundColor: '#143A73', height: 13, left: 2, position: 'absolute', top: 2, transform: [{ rotate: '24deg' }], width: 21 },
  boxTopRight: { backgroundColor: '#143A73', height: 13, position: 'absolute', right: 2, top: 2, transform: [{ rotate: '-24deg' }], width: 21 },
  boxBottomLeft: { backgroundColor: '#143A73', height: 29, left: 4, position: 'absolute', top: 14, transform: [{ skewY: '24deg' }], width: 20 },
  boxBottomRight: { backgroundColor: '#143A73', height: 29, position: 'absolute', right: 4, top: 14, transform: [{ skewY: '-24deg' }], width: 20 },
  boxLight: { backgroundColor: '#D5F0FF' },
  boxGreen: { backgroundColor: '#143A73' },
  brandMark: { alignItems: 'center', flexDirection: 'row' },
  brandMarkText: { color: '#143A73', fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  welcomeBrand: { marginBottom: 38, marginTop: 12 },
  welcomeHero: { borderRadius: 28, height: 330, width: '100%' },
  welcomePill: { alignSelf: 'flex-start', backgroundColor: '#D5F0FF', borderRadius: 24, marginTop: 26, paddingHorizontal: 16, paddingVertical: 9 },
  welcomePillText: { color: '#143A73', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  welcomeTitle: { color: '#143A73', fontSize: 40, fontWeight: '800', letterSpacing: -1.5, lineHeight: 44, marginTop: 26 },
  welcomeDescription: { color: '#6B7F99', fontSize: 17, lineHeight: 27, marginTop: 22 },
  welcomeSignIn: { alignItems: 'center', paddingVertical: 22 },
  welcomeSignInText: { color: '#143A73', fontSize: 17, fontWeight: '700' },
  welcomeAdminSignIn: { alignItems: 'center', paddingBottom: 8, paddingTop: 2 },
  welcomeAdminSignInText: { color: '#6B7F99', fontSize: 12, fontWeight: '600' },
  freshStartBadge: { alignSelf: 'flex-start', backgroundColor: '#D5E7FF', borderRadius: 999, color: '#1B4D8F', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginTop: 18, overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 8, textAlign: 'center' },
  roleChoiceTitle: { color: '#1D4E89', fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 44, marginTop: 14 },
  roleChoiceQuestion: { color: '#1D4E89', fontSize: 16, fontWeight: '500', marginBottom: 16, marginTop: 18 },
  roleChoiceCard: { alignItems: 'center', backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginBottom: 12, minHeight: 82, paddingHorizontal: 16, paddingVertical: 12 },
  roleChoiceCardSelected: { backgroundColor: '#D9EAFD', borderColor: '#1B4D8F', borderWidth: 2 },
  roleChoiceIconWrap: { alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  roleChoiceIcon: { fontSize: 28 },
  roleChoiceTextWrap: { flex: 1 },
  roleChoiceCardTitle: { color: '#173F71', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  roleChoiceCardDescription: { color: '#466A8B', fontSize: 14, lineHeight: 19, marginTop: 4 },
  roleChoiceRadio: { alignItems: 'center', borderColor: '#1B4D8F', borderRadius: 999, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 },
  roleChoiceRadioSelected: { backgroundColor: '#1B4D8F' },
  roleChoiceCheck: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  roleChoicePrimaryButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 14, marginTop: 14, paddingHorizontal: 14, paddingVertical: 15 },
  roleChoicePrimaryButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  roleChoiceSecondaryTextWrap: { alignItems: 'center', marginTop: 16 },
  roleChoiceSecondaryText: { color: '#1D4E89', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  roleChoiceNote: { color: '#466A8B', fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'left' },
  header: { marginTop: 42 },
  eyebrow: { color: '#6A756E', fontSize: 12, fontWeight: '700', letterSpacing: 1.8 },
  title: { color: '#143A73', fontSize: 48, fontWeight: '800', letterSpacing: -1.5, marginTop: 6 },
  subtitle: { color: '#536A86', fontSize: 16, lineHeight: 24, marginTop: 12, maxWidth: 340 },
  roleSection: { marginTop: 34, flex: 1, justifyContent: 'center' },
  sectionTitle: { color: '#1B2B40', fontSize: 20, fontWeight: '700' },
  sectionHint: { color: '#6B7F99', fontSize: 14, marginTop: 6, marginBottom: 18 },
  roleCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginBottom: 12, minHeight: 92, paddingHorizontal: 16 },
  selectedCard: { backgroundColor: '#D5F0FF', borderColor: '#8FB8E8', borderWidth: 2 },
  pressedCard: { opacity: 0.8 },
  iconCircle: { alignItems: 'center', backgroundColor: '#D5F0FF', borderRadius: 14, height: 52, justifyContent: 'center', width: 52 },
  iconText: { color: '#143A73', fontSize: 27, fontWeight: '700' },
  roleCopy: { flex: 1, marginHorizontal: 14 },
  roleTitle: { color: '#1B2B40', fontSize: 16, fontWeight: '700' },
  roleDescription: { color: '#6B7F99', fontSize: 13, lineHeight: 18, marginTop: 4 },
  radio: { alignItems: 'center', borderColor: '#A8C4E2', borderRadius: 10, borderWidth: 1.5, height: 20, justifyContent: 'center', width: 20 },
  radioSelected: { borderColor: '#143A73' },
  radioDot: { backgroundColor: '#143A73', borderRadius: 5, height: 10, width: 10 },
  footer: { marginTop: 20 },
  primaryButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 18, flexDirection: 'row', height: 62, justifyContent: 'center', marginTop: 18 },
  disabledButton: { backgroundColor: '#A8C4E2' },
  pressedButton: { opacity: 0.8 },
  primaryText: { color: '#FFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  arrow: { color: '#D5F0FF', fontSize: 22, marginLeft: 10 },
  secondaryButton: { alignItems: 'center', borderColor: '#A8C4E2', borderRadius: 14, borderWidth: 1, height: 56, justifyContent: 'center', marginTop: 12 },
  secondaryText: { color: '#143A73', fontSize: 15, fontWeight: '700' },
  terms: { color: '#7D91A8', fontSize: 11, lineHeight: 16, marginTop: 12, textAlign: 'center' },
  termsLink: { color: '#143A73', fontWeight: '700', textDecorationLine: 'underline' },
  termsIntro: { color: '#536A86', fontSize: 15, lineHeight: 23, marginTop: 12 },
  termsSection: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 16 },
  termsSectionTitle: { color: '#143A73', fontSize: 17, fontWeight: '800' },
  termsSectionText: { color: '#536A86', fontSize: 14, lineHeight: 22, marginTop: 10 },
  termsReviewNote: { color: '#7D91A8', fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'center' },
  backButton: { alignItems: 'center', flexDirection: 'row', minHeight: 40 },
  backArrow: { color: '#1D4E89', fontSize: 30, fontWeight: '700', marginRight: 8 },
  backText: { color: '#143A73', fontSize: 15, fontWeight: '600' },
  centerContent: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 520, paddingBottom: 30 },
  pageTitle: { color: '#143A73', fontSize: 30, fontWeight: '800', marginTop: 28, textAlign: 'center' },
  pageDescription: { color: '#536A86', fontSize: 16, lineHeight: 24, marginTop: 10, maxWidth: 340, textAlign: 'center' },
  pageTitleLeft: { color: '#143A73', fontSize: 30, fontWeight: '800', marginTop: 34 },
  pageDescriptionLeft: { color: '#536A86', fontSize: 16, lineHeight: 24, marginTop: 10 },
  formHeader: { marginTop: 42 },
  form: { marginTop: 32 },
  accountHeaderRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  backButtonWrap: { width: 36 },
  accountBrand: { alignItems: 'flex-end', flex: 1, justifyContent: 'center', marginBottom: 18 },
  accountEyebrow: { color: '#143A73', fontSize: 15, fontWeight: '700', letterSpacing: 0.3, marginTop: 6 },
  accountTitle: { color: '#1D4E89', fontSize: 38, fontWeight: '800', letterSpacing: -1.2, lineHeight: 44, marginTop: 18 },
  accountDescription: { color: '#466A8B', fontSize: 18, lineHeight: 28, marginTop: 10 },
  recoveryCodeInput: { borderBottomColor: '#1D4E89', borderBottomWidth: 2, color: '#143A73', fontSize: 29, fontWeight: '700', letterSpacing: 14, marginBottom: 34, marginTop: 16, minHeight: 62, paddingHorizontal: 10, textAlign: 'center' },
  recoveryResendRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginBottom: 30, marginTop: 2 },
  recoveryResendText: { color: '#536A86', fontSize: 16 },
  recoveryResendLink: { color: '#143A73', fontSize: 16, fontWeight: '700', marginLeft: 5, textDecorationLine: 'underline' },
  recoveryPasswordInputWrap: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D9D4C7', borderRadius: 14, borderWidth: 1, flexDirection: 'row', height: 58, marginBottom: 20, paddingLeft: 16, paddingRight: 10 },
  recoveryPasswordInputError: { borderColor: '#CC3344' },
  recoveryPasswordInput: { color: '#1B2B40', flex: 1, fontSize: 18, height: '100%', paddingVertical: 0 },
  recoveryPasswordToggle: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 40 },
  recoveryPasswordHint: { color: '#7D91A8', fontSize: 13, marginBottom: 18, marginTop: -12 },
  recoverySuccessCard: { alignItems: 'center', backgroundColor: '#4CA653', borderRadius: 16, flexDirection: 'row', gap: 12, marginTop: 25, paddingHorizontal: 18, paddingVertical: 20 },
  recoverySuccessText: { color: '#FFF', flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  changeRolePill: { alignSelf: 'flex-start', backgroundColor: '#D5F0FF', borderRadius: 24, marginBottom: 34, marginTop: 24, paddingHorizontal: 18, paddingVertical: 11 },
  changeRoleText: { color: '#143A73', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  showPassword: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', marginBottom: 18, marginTop: -4, paddingVertical: 7 },
  showPasswordIcon: { color: '#143A73', fontSize: 20, marginRight: 10 },
  showPasswordText: { color: '#143A73', fontSize: 15, fontWeight: '700' },
  accountTerms: { color: '#6B7F99', fontSize: 15, lineHeight: 23, marginTop: 26 },
  registeredLink: { alignItems: 'center', paddingVertical: 20 },
  registeredLinkText: { color: '#143A73', fontSize: 17, fontWeight: '700' },
  field: { marginBottom: 18 },
  fieldLabel: { color: '#1D4E89', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: '#F3F2EC', borderColor: '#D9D4C7', borderRadius: 14, borderWidth: 1, color: '#1B2B40', fontSize: 18, height: 56, paddingHorizontal: 16 },
  multilineInput: { height: 92, paddingTop: 14, textAlignVertical: 'top' },
  imagePicker: { alignItems: 'center', backgroundColor: '#F4F8FC', borderColor: '#8FB8E8', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1.5, justifyContent: 'center', minHeight: 150, overflow: 'hidden' },
  imagePickerIcon: { color: '#143A73', fontSize: 32, fontWeight: '300' },
  imagePickerText: { color: '#143A73', fontSize: 15, fontWeight: '700', marginTop: 6 },
  imagePickerHint: { color: '#6B7F99', fontSize: 12, marginTop: 4 },
  imagePreview: { height: 190, width: '100%' },
  inventoryImage: { borderRadius: 10, height: 48, marginRight: 10, width: 48 },
  inventoryEmoji: { fontSize: 28, marginRight: 10 },
  inventoryAction: { paddingHorizontal: 5, paddingVertical: 8 },
  inventoryActionText: { color: '#143A73', fontSize: 12, fontWeight: '700' },
  deleteActionText: { color: '#B14C4C', fontSize: 12, fontWeight: '700' },
  formHint: { color: '#7D91A8', fontSize: 12, marginTop: 10, textAlign: 'center' },
  authError: { color: '#B14C4C', fontSize: 13, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  authWelcomeTopBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, marginTop: 4 },
  authWelcomeHero: { backgroundColor: '#143A73', borderRadius: 28, marginTop: 12, overflow: 'hidden', padding: 24 },
  authWelcomeOrb: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 100, height: 190, position: 'absolute', right: -54, top: -64, width: 190 },
  authWelcomeOrbSmall: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 70, bottom: -52, height: 140, position: 'absolute', right: 34, width: 140 },
  authWelcomeEyebrow: { color: '#BFD9F6', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  authWelcomeIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 28, height: 58, justifyContent: 'center', marginTop: 28, width: 58 },
  authWelcomeIconText: { color: '#143A73', fontSize: 28, fontWeight: '800' },
  authWelcomeTitle: { color: '#FFF', fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginTop: 22 },
  authWelcomeRole: { alignSelf: 'flex-start', backgroundColor: '#28518A', borderRadius: 999, color: '#D9EAFD', fontSize: 12, fontWeight: '700', marginTop: 10, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 6, textTransform: 'uppercase' },
  authWelcomeDescription: { color: '#E1EDFC', fontSize: 16, lineHeight: 24, marginTop: 18 },
  authWelcomePerk: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.15)', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginTop: 24, paddingHorizontal: 12, paddingVertical: 11 },
  authWelcomePerkCheck: { color: '#BFE6D0', fontSize: 15, fontWeight: '800', marginRight: 8 },
  authWelcomePerkText: { color: '#F3F8FF', flexShrink: 1, fontSize: 12, fontWeight: '600' },
  authWelcomePrimaryButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 17, flexDirection: 'row', justifyContent: 'center', marginTop: 20, minHeight: 60, paddingHorizontal: 16 },
  authWelcomePrimaryText: { color: '#FFF', flexShrink: 1, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  authWelcomeArrow: { marginLeft: 10 },
  authWelcomeSecondaryButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#C4D8F0', borderRadius: 16, borderWidth: 1, justifyContent: 'center', marginTop: 12, minHeight: 56, paddingHorizontal: 16 },
  authWelcomeSecondaryText: { color: '#143A73', fontSize: 15, fontWeight: '700' },
  authWelcomeAdminNote: { color: '#536A86', fontSize: 13, lineHeight: 20, marginTop: 18, textAlign: 'center' },
  rememberLoginRow: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', marginBottom: 14, marginTop: -4, minHeight: 36, paddingRight: 8 },
  rememberLoginCheckbox: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#A8C4E2', borderRadius: 6, borderWidth: 1.5, height: 20, justifyContent: 'center', marginRight: 9, width: 20 },
  rememberLoginCheckboxSelected: { backgroundColor: '#143A73', borderColor: '#143A73' },
  rememberLoginCheck: { color: '#FFF', fontSize: 13, fontWeight: '800', lineHeight: 16 },
  rememberLoginLabel: { color: '#536A86', fontSize: 13, fontWeight: '600' },
  authDivider: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 20 },
  authDividerLine: { backgroundColor: '#D6E4F2', flex: 1, height: 1 },
  authDividerText: { color: '#6B7F99', fontSize: 13, fontWeight: '600' },
  socialButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  socialButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: 'row', height: 52, justifyContent: 'center', paddingHorizontal: 8 },
  socialButtonText: { color: '#143A73', fontSize: 17, fontWeight: '800', marginRight: 7 },
  socialButtonLabel: { color: '#1B2B40', fontSize: 13, fontWeight: '700' },
  socialAuthHint: { color: '#7D91A8', fontSize: 11, lineHeight: 16, marginTop: 10, textAlign: 'center' },
  forgotPassword: { color: '#143A73', fontSize: 13, fontWeight: '600', marginBottom: 10, textAlign: 'right' },
  locationHint: { alignItems: 'center', flexDirection: 'row', marginBottom: 10, paddingVertical: 8 },
  currentLocationButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#D9EAFD', borderColor: '#A8C4E2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginBottom: 10, marginTop: 16, minHeight: 48, paddingHorizontal: 15 },
  currentLocationIcon: { marginRight: 9 },
  currentLocationButtonText: { color: '#143A73', fontSize: 14, fontWeight: '800' },
  locationCard: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 18, flexDirection: 'row', marginBottom: 12, padding: 18 },
  locationOr: { color: '#466A8B', fontSize: 16, marginBottom: 18, marginTop: 6 },
  locationIcon: { color: '#1D4E89', fontSize: 24, marginRight: 10 },
  infoCard: { backgroundColor: '#D9EAFD', borderRadius: 18, marginTop: 10, padding: 16 },
  infoCardTitle: { color: '#143A73', fontSize: 15, fontWeight: '800' },
  infoCardText: { color: '#536A86', fontSize: 13, lineHeight: 19, marginTop: 6 },
  accountInfoCard: { backgroundColor: '#D5F0FF', borderRadius: 16, marginTop: 6, paddingHorizontal: 16, paddingVertical: 2 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  choicePill: { borderColor: '#A8C4E2', borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  choicePillSelected: { backgroundColor: '#143A73', borderColor: '#143A73' },
  choicePillText: { color: '#143A73', fontSize: 14, fontWeight: '700' },
  choicePillTextSelected: { color: '#FFF' },
  locationHintText: { color: '#143A73', fontSize: 14, fontWeight: '600' },
  successMark: { alignItems: 'center', backgroundColor: '#D5F0FF', borderRadius: 40, height: 80, justifyContent: 'center', width: 80 },
  successText: { color: '#143A73', fontSize: 42, fontWeight: '700' },
  dashboardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  dashboardGreeting: { color: '#6B7F99', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  dashboardTitle: { color: '#143A73', fontSize: 25, fontWeight: '800', letterSpacing: -0.5, marginTop: 5 },
  searchBox: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 17, borderWidth: 1, flexDirection: 'row', height: 56, marginTop: 28, paddingHorizontal: 16, shadowColor: '#143A73', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  searchIcon: { color: '#143A73', fontSize: 25, marginRight: 10 },
  searchInput: { color: '#1B2B40', flex: 1, fontSize: 14, height: 50 },
  localvegRowHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: 12 },
  sectionEyebrow: { color: '#1D4E89', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginTop: 18 },
  operationsTitle: { color: '#1D4E89', fontSize: 40, fontWeight: '800', letterSpacing: -1.5, lineHeight: 44, marginTop: 18 },
  operationsSubtitle: { color: '#466A8B', fontSize: 17, lineHeight: 27, marginTop: 14 },
  stageBadge: { alignSelf: 'flex-start', backgroundColor: '#F1C7A7', borderRadius: 12, marginTop: 20, paddingHorizontal: 14, paddingVertical: 8 },
  stageBadgeText: { color: '#1D4E89', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  inviteCard: { backgroundColor: '#D9EAFD', borderRadius: 14, marginTop: 18, paddingHorizontal: 16, paddingVertical: 18 },
  inviteCardTitle: { color: '#1D4E89', fontSize: 18, fontWeight: '800' },
  inviteCardText: { color: '#466A8B', fontSize: 15, marginTop: 8 },
  mutedCopy: { alignItems: 'flex-start', marginTop: 6 },
  mutedText: { color: '#466A8B', fontSize: 13, fontWeight: '600' },
  termsText: { color: '#466A8B', fontSize: 14, lineHeight: 21, marginTop: 10 },
  storeSetupTitle: { color: '#1D4E89', fontSize: 32, fontWeight: '800', letterSpacing: -1.1, lineHeight: 38, marginTop: 20 },
  storeSetupSubtitle: { color: '#536A86', fontSize: 15, lineHeight: 24, marginTop: 10 },
  helperText: { color: '#6B7F99', fontSize: 12, marginBottom: 12, marginTop: -10 },
  noticeText: { color: '#536A86', fontSize: 13, lineHeight: 20, marginTop: 8 },
  completeBadgeWrap: { alignItems: 'center', marginTop: 16 },
  completeBadge: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 80, height: 120, justifyContent: 'center', width: 120 },
  completeBadgeText: { color: '#1D4E89', fontSize: 44 },
  eyebrowPill: { alignSelf: 'center', backgroundColor: '#D9EAFD', borderRadius: 999, marginTop: 22, paddingHorizontal: 18, paddingVertical: 8 },
  eyebrowPillText: { color: '#1D4E89', fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
  completeHeadline: { color: '#1D4E89', fontSize: 46, fontWeight: '800', letterSpacing: -1.7, lineHeight: 48, marginTop: 24, textAlign: 'left' },
  completeSubtitle: { color: '#466A8B', fontSize: 19, lineHeight: 30, marginTop: 18 },
  locationSummary: { alignItems: 'center', backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginTop: 28, padding: 18 },
  locationSummaryIcon: { color: '#1D4E89', fontSize: 23, marginRight: 12 },
  locationSummaryTextWrap: { flex: 1 },
  locationSummaryValue: { color: '#1B2B40', fontSize: 20, fontWeight: '700' },
  locationSummarySub: { color: '#536A86', fontSize: 14, lineHeight: 22, marginTop: 4 },
  inlineGuide: { color: '#466A8B', fontSize: 15, lineHeight: 24, marginTop: 24, textAlign: 'center' },
  progressIndicator: { alignSelf: 'center', backgroundColor: '#1D4E89', borderRadius: 999, height: 5, marginTop: 22, width: 84 },
  marketBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  notificationButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 22, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  notificationBadge: { alignItems: 'center', backgroundColor: '#D94A4A', borderColor: '#FFF', borderRadius: 10, borderWidth: 1, height: 19, justifyContent: 'center', minWidth: 19, paddingHorizontal: 4, position: 'absolute', right: -3, top: -3 },
  notificationBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
  marketBrandWrap: { alignItems: 'center', flexDirection: 'row' },
  marketLeaf: { color: '#1D4E89', fontSize: 24, marginRight: 10 },
  marketBrandText: { color: '#1D4E89', fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  sellerPill: { backgroundColor: '#EDF4FE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  sellerPillText: { color: '#1D4E89', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  marketBasketWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  marketBasketIcon: { fontSize: 24 },
  marketBasketBadge: { alignItems: 'center', backgroundColor: '#F7FAFF', borderRadius: 10, height: 20, justifyContent: 'center', position: 'absolute', right: -8, top: -4, width: 20 },
  marketBasketBadgeText: { color: '#1D4E89', fontSize: 10, fontWeight: '800' },
  locationPanel: { alignItems: 'center', backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginTop: 22, minHeight: 62, paddingHorizontal: 16 },
  locationPin: { marginRight: 12 },
  locationTextWrap: { flex: 1 },
  locationLabel: { color: '#1D4E89', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  locationValue: { color: '#1B2B40', fontSize: 15, fontWeight: '700', marginTop: 3 },
  locationChevron: { color: '#1D4E89', fontSize: 20, marginLeft: 8 },
  searchPanel: { alignItems: 'center', backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 20, borderWidth: 1, flexDirection: 'row', marginTop: 18, minHeight: 60, paddingHorizontal: 16 },
  storeMeta: { color: '#466A8B', fontSize: 14, marginTop: 18 },
  storeHeroTitle: { color: '#1D4E89', fontSize: 30, fontWeight: '800', letterSpacing: -1.1, marginTop: 10 },
  storeHeroSubtitle: { color: '#466A8B', fontSize: 16, lineHeight: 24, marginTop: 8 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  statBox: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 14, flex: 1, marginRight: 8, paddingVertical: 18 },
  statValue: { color: '#1D4E89', fontSize: 28, fontWeight: '800' },
  statLabel: { color: '#466A8B', fontSize: 12, marginTop: 6 },
  primaryDarkButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 16, marginTop: 24, paddingHorizontal: 18, paddingVertical: 16 },
  primaryDarkButtonLarge: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 18, marginTop: 24, paddingHorizontal: 20, paddingVertical: 18 },
  primaryDarkButtonText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  sectionTitleSale: { color: '#1D4E89', fontSize: 24, fontWeight: '800', marginTop: 26, marginBottom: 10 },
  orderCard: { backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, padding: 14 },
  orderHeadRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  orderId: { color: '#1B2B40', fontSize: 18, fontWeight: '800' },
  orderIdSecondary: { color: '#1B2B40', fontSize: 18, fontWeight: '800' },
  readyTag: { backgroundColor: '#D9EAFD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  readyTagText: { color: '#1D4E89', fontSize: 12, fontWeight: '700' },
  orderSub: { color: '#466A8B', fontSize: 14, marginTop: 6 },
  orderTotal: { color: '#1B2B40', fontSize: 15, fontWeight: '700', marginTop: 10 },
  orderMeta: { color: '#466A8B', fontSize: 13, lineHeight: 19, marginTop: 10 },
  lightPanelButton: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 14, marginTop: 14, paddingVertical: 14 },
  lightPanelButtonText: { color: '#1D4E89', fontSize: 18, fontWeight: '800' },
  orderCardSecondary: { backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, marginTop: 14, padding: 14 },
  warningTag: { alignSelf: 'flex-start', backgroundColor: '#F3E1D4', borderRadius: 999, marginTop: 10, paddingHorizontal: 10, paddingVertical: 6 },
  warningTagText: { color: '#8C5B2A', fontSize: 12, fontWeight: '700' },
  primaryDarkButtonSecondary: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 14, marginTop: 14, paddingVertical: 14 },
  inventorySectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  inventorySectionTitle: { color: '#1B2B40', fontSize: 24, fontWeight: '800' },
  inventoryMeta: { color: '#466A8B', fontSize: 12, fontWeight: '700' },
  groceryItemCard: { alignItems: 'center', backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginTop: 12, padding: 10 },
  groceryThumb: { borderRadius: 10, height: 74, width: 74 },
  sellerHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, marginTop: 12 },
  sellerHeaderProfile: { alignItems: 'center', borderColor: '#A8C4E2', borderRadius: 22, borderWidth: 1.5, height: 44, justifyContent: 'center', width: 44 },
  sellerStoreMeta: { color: '#536A86', fontSize: 14, marginTop: 2 },
  sellerListingTopBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 26 },
  sellerListingEyebrow: { color: '#286446', fontSize: 13, fontWeight: '800', letterSpacing: 0.6, marginBottom: 20 },
  sellerListingTitle: { color: '#143A73', fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 40 },
  sellerListingDescription: { color: '#6A7D72', fontSize: 16, lineHeight: 24, marginBottom: 28, marginTop: 12 },
  bulkModeButton: { alignItems: 'center', alignSelf: 'flex-start', borderColor: '#A8C4E2', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 9, marginBottom: 22, paddingHorizontal: 13, paddingVertical: 11 },
  bulkModeButtonText: { color: '#143A73', fontSize: 14, fontWeight: '700' },
  bulkPhotoActions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  bulkPhotoAction: { alignItems: 'center', backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 110, justifyContent: 'center', padding: 12 },
  bulkPhotoActionText: { color: '#143A73', fontSize: 14, fontWeight: '800', marginTop: 6 },
  bulkPhotoActionHint: { color: '#6B7F99', fontSize: 11, marginTop: 4, textAlign: 'center' },
  bulkProductCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 14 },
  bulkProductHeading: { alignItems: 'center', flexDirection: 'row', marginBottom: 16 },
  bulkProductImage: { backgroundColor: '#F2F7FF', borderRadius: 10, height: 68, width: 76 },
  bulkProductHeadingCopy: { flex: 1, marginLeft: 12 },
  bulkProductTitle: { color: '#143A73', fontSize: 16, fontWeight: '800' },
  bulkProductHint: { color: '#6B7F99', fontSize: 12, lineHeight: 17, marginTop: 3 },
  bulkRemoveButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  bulkEmptyState: { alignItems: 'center', backgroundColor: '#F2F7FF', borderRadius: 16, marginTop: 14, padding: 24 },
  bulkEmptyTitle: { color: '#143A73', fontSize: 16, fontWeight: '800', marginTop: 8 },
  bulkEmptyText: { color: '#6B7F99', fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  sellerProductPhotoPicker: { backgroundColor: '#F3F7FA', borderColor: '#BDD5EC', borderRadius: 16, borderWidth: 1, marginBottom: 7, minHeight: 160, overflow: 'hidden' },
  sellerProductPhoto: { height: 190, width: '100%' },
  sellerProductPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center', minHeight: 160 },
  sellerReplacePhoto: { alignSelf: 'flex-start', marginBottom: 22, paddingVertical: 5 },
  sellerReplacePhotoText: { color: '#143A73', fontSize: 14, fontWeight: '700' },
  sellerProductFormRow: { flexDirection: 'row', gap: 12 },
  sellerProductFormColumn: { flex: 1, minWidth: 0 },
  sellerUnitChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  sellerUnitChoice: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D9E1D8', borderRadius: 14, borderWidth: 1, flexDirection: 'row', flexGrow: 1, gap: 9, minHeight: 54, paddingHorizontal: 13 },
  sellerUnitChoiceSelected: { backgroundColor: '#E8F2FA', borderColor: '#E8F2FA' },
  sellerUnitChoiceText: { color: '#143A73', fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  sellerAvailabilityRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, marginTop: 8, minHeight: 58 },
  sellerAvailabilityCopy: { flex: 1, paddingRight: 12 },
  sellerAvailabilityTitle: { color: '#143A73', fontSize: 16, fontWeight: '800' },
  sellerAvailabilityHint: { color: '#6A7D72', fontSize: 13, lineHeight: 19, marginTop: 4 },
  sellerAvailabilityPill: { backgroundColor: '#EDF1EE', borderRadius: 999, minWidth: 72, paddingHorizontal: 13, paddingVertical: 9 },
  sellerAvailabilityPillOn: { backgroundColor: '#E8F0E3' },
  sellerAvailabilityPillText: { color: '#66766D', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  sellerAvailabilityPillTextOn: { color: '#286446' },
  sellerCurrencyNote: { color: '#7A897F', fontSize: 13, lineHeight: 19, marginBottom: 8, marginTop: 4 },
  sellerVerificationPanel: { alignItems: 'flex-start', backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 14, borderWidth: 1, marginTop: 14, padding: 12 },
  sellerVerificationCopy: { color: '#536A86', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  verificationPhotoPicker: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#C9DBF3', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 8, minHeight: 66, padding: 9, width: '100%' },
  verificationPhotoPreview: { backgroundColor: '#EAF3FF', borderRadius: 8, height: 48, width: 58 },
  verificationPhotoPlaceholder: { alignItems: 'center', backgroundColor: '#EAF3FF', borderRadius: 8, height: 48, justifyContent: 'center', width: 58 },
  verificationPhotoCopy: { flex: 1 },
  verificationPhotoLabel: { color: '#1B2B40', fontSize: 12, fontWeight: '700' },
  verificationPhotoAction: { color: '#6B7F99', fontSize: 11, marginTop: 4 },
  storeVerifiedMark: { alignItems: 'center', backgroundColor: '#E4F4EC', borderRadius: 999, flexDirection: 'row', gap: 4, paddingHorizontal: 7, paddingVertical: 3 },
  storeVerifiedText: { color: '#0F6B46', fontSize: 10, fontWeight: '800' },
  sellerHeroTitle: { color: '#143A73', fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 40, marginTop: 12 },
  sellerHeroSubtitle: { color: '#536A86', fontSize: 15, lineHeight: 22, marginTop: 6 },
  sellerMetrics: { flexDirection: 'row', gap: 10, marginTop: 22 },
  sellerMetric: { backgroundColor: '#D9EAFD', borderRadius: 18, flex: 1, justifyContent: 'center', minHeight: 82, paddingHorizontal: 13, paddingVertical: 12 },
  sellerBalanceCard: { backgroundColor: '#143A73', borderRadius: 18, marginTop: 16, padding: 16 },
  sellerBalanceHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  sellerBalanceEyebrow: { color: '#C9DFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sellerBalanceValue: { color: '#FFF', fontSize: 27, fontWeight: '800', marginTop: 7 },
  sellerBalanceCaption: { color: '#D9ECFF', fontSize: 12, marginTop: 2 },
  sellerBalanceDetails: { borderTopColor: '#41618B', borderTopWidth: 1, flexDirection: 'row', gap: 12, marginTop: 14, paddingTop: 12 },
  sellerBalanceDetail: { flex: 1 },
  sellerBalanceDetailValue: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  sellerBalanceDetailLabel: { color: '#D9ECFF', fontSize: 10, lineHeight: 14, marginTop: 4 },
  sellerBalanceNote: { color: '#C9DFFF', fontSize: 10, lineHeight: 15, marginTop: 12 },
  sellerReviewsCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 14 },
  sellerReviewRow: { borderTopColor: '#E7EEF7', borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  sellerReviewRating: { color: '#A15C00', fontSize: 13, fontWeight: '800' },
  sellerReviewDate: { color: '#7D91A8', fontSize: 10, marginTop: 4 },
  sellerMetricValue: { color: '#143A73', fontSize: 29, fontWeight: '800' },
  sellerMetricLabel: { color: '#536A86', fontSize: 12, lineHeight: 16, marginTop: 6 },
  sellerAddButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 16, justifyContent: 'center', marginTop: 20, minHeight: 58 },
  sellerAddButtonContent: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  sellerAddButtonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  sellerSectionTitle: { color: '#1B2B40', fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  sellerEmptyText: { color: '#6B7F99', fontSize: 14, lineHeight: 21, marginTop: 14 },
  sellerOrderCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, marginTop: 12, padding: 16 },
  sellerOrderHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  sellerOrderId: { color: '#1B2B40', fontSize: 17, fontWeight: '800' },
  sellerStatusPill: { alignSelf: 'flex-start', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 7 },
  sellerStatusReady: { backgroundColor: '#D9EAFD' },
  sellerStatusPending: { backgroundColor: '#FCE8D9' },
  sellerStatusText: { color: '#143A73', fontSize: 11, fontWeight: '800' },
  sellerStatusPendingText: { color: '#A44A13' },
  sellerOrderMeta: { color: '#536A86', fontSize: 13, lineHeight: 19, marginTop: 12 },
  sellerOrderItem: { color: '#536A86', fontSize: 13, lineHeight: 19, marginTop: 6 },
  sellerSubstitutionItem: { borderTopColor: '#E7EEF7', borderTopWidth: 1, marginTop: 8, paddingTop: 6 },
  sellerSubstitutionStatus: { color: '#1D4E89', fontSize: 11, fontWeight: '700', marginTop: 4 },
  substitutionChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 },
  substitutionChoice: { backgroundColor: '#EEF5FF', borderColor: '#C9DBF3', borderRadius: 10, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  substitutionChoiceText: { color: '#143A73', fontSize: 11, fontWeight: '700' },
  sellerOrderTotal: { color: '#143A73', fontSize: 15, fontWeight: '800', marginTop: 12 },
  sellerOrderAssignment: { color: '#6B7F99', fontSize: 13, lineHeight: 19, marginTop: 10 },
  sellerOrderAction: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 14, justifyContent: 'center', marginTop: 14, minHeight: 54, paddingHorizontal: 12 },
  sellerOrderActionText: { color: '#FFF', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  sellerOrderActionDone: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 14, justifyContent: 'center', marginTop: 14, minHeight: 50 },
  sellerOrderActionDoneText: { color: '#143A73', fontSize: 14, fontWeight: '800' },
  sellerInventoryHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, marginTop: 28 },
  sellerProductCard: { alignItems: 'center', backgroundColor: '#FFF', borderRadius: 18, flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, padding: 14 },
  sellerProductDetails: { flex: 1, marginLeft: 12, minWidth: 120 },
  sellerProductActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', marginTop: 14, width: '100%' },
  sellerListingStatus: { fontSize: 11, fontWeight: '700' },
  sellerActionTap: { paddingVertical: 6 },
  sellerFootnote: { color: '#6B7F99', fontSize: 12, lineHeight: 18, marginTop: 18 },
  groceryTextWrap: { flex: 1, marginLeft: 12 },
  groceryName: { color: '#1B2B40', fontSize: 18, fontWeight: '700' },
  groceryStock: { color: '#466A8B', fontSize: 12, marginTop: 6 },
  groceryPrice: { color: '#0F3D6E', fontSize: 16, fontWeight: '800', marginTop: 8 },
  listingActionRow: { alignItems: 'flex-end', marginLeft: 12 },
  statusTextInline: { color: '#1B2B40', fontSize: 12, fontWeight: '700' },
  availableText: { color: '#0F3D6E' },
  unavailableText: { color: '#8C5B2A' },
  linkText: { color: '#0F3D6E', fontSize: 12, fontWeight: '700', marginTop: 8 },
  subtleFooterText: { color: '#466A8B', fontSize: 12, lineHeight: 20, marginTop: 18 },
  marketHero: { backgroundColor: '#D9EAFD', borderRadius: 16, marginTop: 20, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
  marketHeroEyebrow: { color: '#1D4E89', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  marketHeroTitle: { color: '#1B2B40', fontSize: 32, fontWeight: '800', letterSpacing: -1.3, lineHeight: 36, marginTop: 12 },
  marketHeroText: { color: '#3F5D7D', fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 260 },
  marketFilterHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  marketFilterHeadingCopy: { flex: 1, paddingRight: 10 },
  marketFilterHint: { color: '#536A86', fontSize: 12, lineHeight: 17, marginTop: 4 },
  marketFilterClear: { paddingHorizontal: 10, paddingVertical: 8 },
  marketFilterClearText: { color: '#143A73', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  categoryWrap: { flexDirection: 'row', gap: 10, marginTop: 10, paddingRight: 20 },
  verifiedOnlyFilter: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 9 },
  verifiedOnlyFilterActive: { backgroundColor: '#E4F4EC', borderColor: '#9CCFB3' },
  verifiedOnlyFilterText: { color: '#1B2B40', fontSize: 13, fontWeight: '700' },
  marketCategoryHeading: { color: '#143A73', fontSize: 15, fontWeight: '800' },
  marketChip: { alignItems: 'center', backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: 16 },
  marketChipActive: { backgroundColor: '#0F3D6E', borderColor: '#0F3D6E' },
  marketChipText: { color: '#1B2B40', fontSize: 14, fontWeight: '700' },
  marketChipTextActive: { color: '#FFFFFF' },
  marketSectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  marketSectionTitle: { color: '#1B2B40', fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
  marketSectionMeta: { color: '#536A86', fontSize: 12, fontWeight: '700' },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 },
  marketProductCard: { backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, marginBottom: 14, overflow: 'hidden', width: '48%' },
  marketProductImage: { height: 138, width: '100%' },
  marketProductInfo: { paddingHorizontal: 12, paddingTop: 12 },
  marketProductName: { color: '#1B2B40', fontSize: 17, fontWeight: '700' },
  marketProductPrice: { color: '#0F3D6E', fontSize: 18, fontWeight: '800', marginTop: 8 },
  marketProductStoreRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  marketProductStore: { color: '#6B7F99', fontSize: 11 },
  storefrontLink: { color: '#0F3D6E', fontWeight: '700', textDecorationLine: 'underline' },
  storefrontHeader: { alignItems: 'flex-start', backgroundColor: '#F2F7FF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, marginTop: 16, padding: 18 },
  storefrontIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  storefrontHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  storefrontRating: { color: '#A15C00', fontSize: 15, fontWeight: '800', marginTop: 10 },
  storefrontSection: { marginTop: 24 },
  storeReviewCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 14 },
  storeReviewHeader: { alignItems: 'center', flexDirection: 'row' },
  storeBuyerBadge: { alignItems: 'center', backgroundColor: '#EAF3FF', borderRadius: 18, height: 34, justifyContent: 'center', width: 34 },
  storeReviewMeta: { flex: 1, marginLeft: 9 },
  storeReviewBuyer: { color: '#1B2B40', fontSize: 12, fontWeight: '800' },
  storeReviewDate: { color: '#7D91A8', fontSize: 10, marginTop: 2 },
  storeReviewStars: { color: '#A15C00', fontSize: 13, fontWeight: '800' },
  storeReviewComment: { color: '#334B66', fontSize: 13, lineHeight: 20, marginTop: 12 },
  storeVerifiedPurchase: { alignSelf: 'flex-start', backgroundColor: '#E4F4EC', borderRadius: 999, color: '#0F6B46', fontSize: 10, fontWeight: '800', marginTop: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5 },
  storefrontProductCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginTop: 10, padding: 10 },
  storefrontProductDetails: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  storefrontProductImage: { borderRadius: 10, height: 68, width: 68 },
  storefrontProductImageFallback: { alignItems: 'center', backgroundColor: '#EEF5FF', borderRadius: 10, height: 68, justifyContent: 'center', width: 68 },
  marketProductMeta: { color: '#6B7F99', fontSize: 12, marginTop: 4 },
  marketProductFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6 },
  marketProductLink: { color: '#0F3D6E', fontSize: 12, fontWeight: '700' },
  marketProductAdd: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 18, height: 30, justifyContent: 'center', width: 30 },
  marketProductAddText: { color: '#FFFFFF', fontSize: 20, lineHeight: 20 },
  marketLoadMoreButton: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#FFFFFF', borderColor: '#A8C4E2', borderRadius: 14, borderWidth: 1, marginBottom: 8, marginTop: 4, minHeight: 48, justifyContent: 'center', paddingHorizontal: 22 },
  marketLoadMoreText: { color: '#143A73', fontSize: 14, fontWeight: '800' },
  recentOrderCard: { backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, marginTop: 18, paddingHorizontal: 16, paddingVertical: 14 },
  recentOrderHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  recentOrderTitle: { color: '#1B2B40', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  orderStatusPill: { backgroundColor: '#D9EAFD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  orderStatusText: { color: '#0F3D6E', fontSize: 11, fontWeight: '700' },
  recentOrderId: { color: '#536A86', fontSize: 13, fontWeight: '700', marginTop: 10 },
  recentOrderAddress: { color: '#1B2B40', fontSize: 14, marginTop: 4 },
  recentOrderItems: { color: '#1B2B40', fontSize: 14, marginTop: 8 },
  orderProgressTrack: { flexDirection: 'row', gap: 8, marginTop: 14 },
  orderProgressSegmentFilled: { backgroundColor: '#0F3D6E', borderRadius: 999, flex: 1, height: 6 },
  orderProgressSegmentEmpty: { backgroundColor: '#C9DBF3', borderRadius: 999, flex: 1, height: 6 },
  orderProgressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  progressLabel: { color: '#536A86', fontSize: 11, fontWeight: '700' },
  orderSummaryText: { color: '#536A86', fontSize: 12, lineHeight: 18, marginTop: 12 },
  orderLinkButton: { marginTop: 12 },
  orderLinkContent: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  orderLinkText: { color: '#0F3D6E', fontSize: 14, fontWeight: '700' },
  marketFooterBar: { alignItems: 'center', backgroundColor: '#0F3D6E', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  marketFooterItem: { alignItems: 'center', flex: 1 },
  marketFooterItemActive: { alignItems: 'center', flex: 1 },
  marketFooterIcon: { color: '#C9DFFF', fontSize: 18 },
  marketFooterIconActive: { color: '#FFFFFF', fontSize: 18 },
  marketFooterLabel: { color: '#C9DFFF', fontSize: 11, marginTop: 4 },
  marketFooterLabelActive: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', marginTop: 4 },
  bottomNavigation: { alignItems: 'stretch', backgroundColor: '#FFFFFF', borderTopColor: '#D6E4F2', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingTop: 7, paddingBottom: 5 },
  bottomNavigationItem: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 48, paddingVertical: 2 },
  bottomNavigationIconWrap: { alignItems: 'center', height: 23, justifyContent: 'center', minWidth: 24 },
  bottomNavigationBadge: { alignItems: 'center', backgroundColor: '#D34735', borderColor: '#FFFFFF', borderRadius: 8, borderWidth: 1, height: 16, justifyContent: 'center', minWidth: 16, paddingHorizontal: 3, position: 'absolute', right: -9, top: -5 },
  bottomNavigationBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  bottomNavigationLabel: { color: '#71839A', fontSize: 10, fontWeight: '600', marginTop: 3 },
  bottomNavigationLabelActive: { color: '#0F3D6E', fontWeight: '800' },
  heroCard: { backgroundColor: '#143A73', borderRadius: 22, flexDirection: 'row', marginTop: 20, minHeight: 176, overflow: 'hidden', padding: 20 },
  heroCopy: { flex: 1, zIndex: 1 },
  heroEyebrow: { color: '#D5F0FF', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  heroTitle: { color: '#FFF', fontSize: 22, fontWeight: '800', lineHeight: 27, marginTop: 8, maxWidth: 210 },
  heroSubtitle: { color: '#C9DFFF', fontSize: 12, lineHeight: 18, marginTop: 7, maxWidth: 205 },
  heroButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#D5F0FF', borderRadius: 10, flexDirection: 'row', marginTop: 14, paddingHorizontal: 11, paddingVertical: 8 },
  heroButtonText: { color: '#143A73', fontSize: 11, fontWeight: '800' },
  heroButtonArrow: { color: '#143A73', fontSize: 16, marginLeft: 5 },
  heroEmoji: { alignSelf: 'flex-end', fontSize: 84, marginBottom: -16, marginLeft: -18, transform: [{ rotate: '-12deg' }] },
  dashboardSectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 30 },
  dashboardSectionTitle: { color: '#1B2B40', fontSize: 17, fontWeight: '700' },
  seeAll: { color: '#143A73', fontSize: 13, fontWeight: '600' },
  categoryRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  categoryChip: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 82, justifyContent: 'center', paddingHorizontal: 5 },
  selectedCategory: { backgroundColor: '#D5F0FF' },
  categoryIcon: { color: '#143A73', fontSize: 20 },
  categoryText: { color: '#143A73', fontSize: 11, fontWeight: '600', marginTop: 7, textAlign: 'center' },
  productCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, flexDirection: 'row', marginTop: 12, minHeight: 98, padding: 10, shadowColor: '#143A73', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 },
  productImage: { alignItems: 'center', backgroundColor: '#D8E9FC', borderRadius: 15, height: 78, justifyContent: 'center', width: 78 },
  productImageAsset: { borderRadius: 15, height: '100%', width: '100%' },
  secondProductImage: { backgroundColor: '#F8E7D7' },
  productEmoji: { fontSize: 36 },
  productCopy: { flex: 1, marginHorizontal: 12 },
  productName: { color: '#1B2B40', fontSize: 14, fontWeight: '700' },
  productStore: { color: '#6B7F99', fontSize: 12, marginTop: 4 },
  productPrice: { color: '#143A73', fontSize: 13, fontWeight: '700', marginTop: 6 },
  addButton: { alignItems: 'center', backgroundColor: '#143A73', borderRadius: 12, height: 36, justifyContent: 'center', width: 36 },
  addButtonDisabled: { backgroundColor: '#EEF2F6' },
  addButtonText: { color: '#D5F0FF', fontSize: 22, lineHeight: 24 },
  saveButton: { alignItems: 'center', height: 32, justifyContent: 'center', marginRight: 7, width: 28 },
  saveText: { color: '#143A73', fontSize: 22 },
  emptyText: { color: '#6B7F99', fontSize: 14, marginTop: 24, textAlign: 'center' },
  detailPanel: { backgroundColor: '#FFF', borderColor: '#A8C4E2', borderRadius: 18, borderWidth: 1, marginTop: 20, padding: 18 },
  detailTopBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  detailCartButton: { alignItems: 'center', justifyContent: 'center', minHeight: 42, position: 'relative', width: 42 },
  detailGallery: { position: 'relative' },
  detailGalleryCount: { backgroundColor: 'rgba(20, 58, 115, 0.82)', borderRadius: 12, bottom: 10, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', right: 10 },
  detailGalleryCountText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  detailImage: { borderRadius: 15, height: 190, width: '100%' },
  detailImageFallback: { alignItems: 'center', backgroundColor: '#E8F1FC', borderRadius: 15, height: 190, justifyContent: 'center', width: '100%' },
  detailEmoji: { fontSize: 50, textAlign: 'center' },
  detailTitleRow: { alignItems: 'center', flexDirection: 'row', marginTop: 12 },
  detailTitle: { color: '#143A73', flex: 1, fontSize: 20, fontWeight: '800', textAlign: 'left' },
  detailSaveButton: { alignItems: 'center', backgroundColor: '#F3F7FC', borderRadius: 22, height: 42, justifyContent: 'center', marginLeft: 8, width: 42 },
  detailRatingRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  detailRatingStars: { color: '#9B6500', fontSize: 14, fontWeight: '800' },
  detailRatingCaption: { color: '#6B7F99', fontSize: 12 },
  detailSection: { marginTop: 22 },
  detailSectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  detailSectionTitle: { color: '#143A73', fontSize: 17, fontWeight: '800' },
  sizeChoice: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 9, padding: 12 },
  sizeChoiceSelected: { backgroundColor: '#F0F7F1', borderColor: '#4C9A6A' },
  sizeChoiceName: { color: '#1B2B40', fontSize: 14, fontWeight: '700' },
  sizeChoiceMeta: { color: '#6B7F99', fontSize: 12, marginTop: 4 },
  customQuantityInput: { backgroundColor: '#FFF', borderColor: '#C9DBF3', borderRadius: 12, borderWidth: 1, color: '#1B2B40', fontSize: 16, marginTop: 9, paddingHorizontal: 14, paddingVertical: 12 },
  detailPriceEstimate: { color: '#1D6A46', fontSize: 14, fontWeight: '800', marginTop: 8 },
  relatedProductCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 13, borderWidth: 1, flexDirection: 'row', marginTop: 10, padding: 10 },
  variantEditorHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  variantEditorCard: { backgroundColor: '#F7FAFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 12 },
  variantAddButton: { alignItems: 'center', flexDirection: 'row', gap: 5, marginLeft: 8, paddingVertical: 8 },
  variantAddButtonText: { color: '#143A73', fontSize: 12, fontWeight: '800' },
  detailMetaRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  detailMetaItem: { backgroundColor: '#F3F7FC', borderRadius: 12, flex: 1, padding: 12 },
  detailMetaLabel: { color: '#6B7F99', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  detailMetaValue: { color: '#143A73', fontSize: 14, fontWeight: '700', marginTop: 5 },
  orderStatus: { color: '#143A73', fontSize: 13, fontWeight: '600', marginTop: 14, textAlign: 'center' },
  emptyState: { alignItems: 'center', justifyContent: 'center', minHeight: 430, paddingHorizontal: 20 },
  emptyIconWrap: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 34, height: 88, justifyContent: 'center', width: 88 },
  emptyEmoji: { color: '#143A73', fontSize: 48 },
  emptyTitle: { color: '#143A73', fontSize: 22, fontWeight: '800', marginTop: 16 },
  cartHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cartHeaderCopy: { flex: 1, paddingRight: 10 },
  cartCountBadge: { alignItems: 'center', alignSelf: 'flex-end', backgroundColor: '#D9EAFD', borderRadius: 16, flexDirection: 'row', gap: 7, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9 },
  cartCountText: { color: '#143A73', fontSize: 14, fontWeight: '800' },
  cartEmptyIconWrap: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 34, height: 88, justifyContent: 'center', width: 88 },
  cartRow: { alignItems: 'flex-start', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginTop: 14, minHeight: 104, padding: 12 },
  cartRowUnselected: { opacity: 0.62 },
  cartSelectAllRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  cartCategoryGroup: { marginTop: 18 },
  cartCategoryTitle: { color: '#143A73', fontSize: 16, fontWeight: '800' },
  cartCheckButton: { alignItems: 'center', borderColor: '#9DAFC3', borderRadius: 10, borderWidth: 1, height: 22, justifyContent: 'center', marginRight: 9, marginTop: 20, width: 22 },
  cartCheckButtonSelected: { backgroundColor: '#1D6A46', borderColor: '#1D6A46' },
  cartPromoButton: { alignItems: 'center', backgroundColor: '#F4F8FE', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginTop: 18, minHeight: 68, padding: 12 },
  cartItemDetails: { flex: 1, marginLeft: 12 },
  cartProductImageFrame: { alignItems: 'center', backgroundColor: '#E8F1FC', borderRadius: 12, height: 62, justifyContent: 'center', overflow: 'hidden', width: 62 },
  cartProductImage: { height: '100%', width: '100%' },
  cartProductPrice: { color: '#143A73', fontSize: 13, fontWeight: '800', marginTop: 5 },
  cartProductMeta: { color: '#536A86', fontSize: 12, fontWeight: '600', marginTop: 5 },
  cartLineTotal: { color: '#143A73', fontSize: 16, fontWeight: '800', marginTop: 8 },
  cartAvailability: { color: '#6B7F99', fontSize: 11, marginTop: 5 },
  cartProductDescription: { color: '#536A86', fontSize: 12, lineHeight: 17, marginTop: 7 },
  cartQuantityControls: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#F3F7FC', borderColor: '#D6E4F2', borderRadius: 9, borderWidth: 1, flexDirection: 'row', marginTop: 10, overflow: 'hidden' },
  cartQuantityButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 36 },
  cartQuantityButtonDisabled: { opacity: 0.4 },
  cartQuantityText: { color: '#1B2B40', fontSize: 14, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  cartRemoveButton: { alignItems: 'center', backgroundColor: '#FFF5F5', borderRadius: 12, height: 38, justifyContent: 'center', marginLeft: 8, width: 38 },
  cartSummaryCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, marginTop: 22, padding: 16 },
  cartSummaryLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cartSummaryLabel: { color: '#536A86', fontSize: 14, fontWeight: '600' },
  cartSummaryAmount: { color: '#143A73', fontSize: 20, fontWeight: '800' },
  cartSummaryHint: { color: '#7D91A8', fontSize: 12, marginTop: 8 },
  promoModalOverlay: { flex: 1, justifyContent: 'flex-end' },
  promoModalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(13, 30, 50, 0.45)' },
  promoModalCard: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 },
  promoModalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  promoCodeInput: { backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 12, borderWidth: 1, color: '#1B2B40', fontSize: 16, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 13 },
  cartCheckoutButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 17, flexDirection: 'row', justifyContent: 'center', marginTop: 14, minHeight: 58, paddingHorizontal: 18 },
  cartCheckoutText: { color: '#FFF', fontSize: 16, fontWeight: '800', marginRight: 10 },
  guestCheckoutCard: { alignItems: 'center', backgroundColor: '#F7FAFF', borderColor: '#C9DBF3', borderRadius: 18, borderWidth: 1, marginTop: 24, padding: 18 },
  guestCheckoutIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  guestCheckoutTitle: { color: '#143A73', fontSize: 20, fontWeight: '800', marginTop: 14 },
  guestCheckoutDescription: { color: '#536A86', fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  removeText: { color: '#B14C4C', fontSize: 12, fontWeight: '600' },
  orderBanner: { backgroundColor: '#D9EAFD', borderRadius: 14, marginTop: 24, padding: 16 },
  orderBannerTitle: { color: '#143A73', fontSize: 16, fontWeight: '800' },
  orderBannerText: { color: '#536A86', fontSize: 13, marginTop: 5 },
  statusText: { color: '#143A73', fontSize: 11, fontWeight: '700' },
  trackingCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginTop: 24, minHeight: 92, padding: 14 },
  substitutionOfferCard: { marginBottom: 8 },
  substitutionBuyerOffer: { backgroundColor: '#F2F7FF', borderRadius: 12, marginTop: 8, padding: 11 },
  substitutionOfferText: { color: '#536A86', fontSize: 12, lineHeight: 18, marginTop: 4 },
  substitutionResponseRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  substitutionAcceptButton: { alignItems: 'center', backgroundColor: '#0F6B46', borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 },
  substitutionAcceptText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  substitutionDeclineButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 9, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  substitutionDeclineText: { color: '#536A86', fontSize: 12, fontWeight: '700' },
  orderFeatureSection: { marginTop: 24 },
  featureCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 13 },
  ratingChoices: { flexDirection: 'row', gap: 7, marginTop: 10 },
  ratingChoice: { alignItems: 'center', backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 10, borderWidth: 1, height: 38, justifyContent: 'center', width: 40 },
  ratingChoiceSelected: { backgroundColor: '#FFF1D6', borderColor: '#E5B85C' },
  ratingChoiceText: { color: '#9AA9BA', fontSize: 21 },
  ratingChoiceTextSelected: { color: '#A15C00' },
  issueTypeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  issueTypeChoice: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#C9DBF3', borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  issueTypeChoiceSelected: { backgroundColor: '#143A73', borderColor: '#143A73' },
  issueTypeChoiceText: { color: '#536A86', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  issueTypeChoiceTextSelected: { color: '#FFF' },
  riderMapCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, marginTop: 18, overflow: 'hidden', padding: 14 },
  riderMap: { borderRadius: 12, height: 260, marginTop: 12, overflow: 'hidden', width: '100%' },
  riderMapError: { alignItems: 'center', backgroundColor: '#F3F7FC', justifyContent: 'center', padding: 20 },
  riderMapUpdated: { color: '#536A86', fontSize: 12, marginTop: 8 },
  riderMapPrivacy: { color: '#6B7F99', fontSize: 11, lineHeight: 16, marginTop: 10 },
  timeline: { marginTop: 26, paddingLeft: 8 },
  timelineStep: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 64 },
  timelineDot: { alignItems: 'center', borderColor: '#A8C4E2', borderRadius: 12, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 },
  timelineDotComplete: { backgroundColor: '#143A73', borderColor: '#143A73' },
  timelineCheck: { color: '#D5F0FF', fontSize: 14, fontWeight: '800' },
  deliveryAddress: { backgroundColor: '#D9EAFD', borderRadius: 14, marginTop: 18, padding: 16 },
  supportOptions: { marginBottom: 28, marginTop: 24 },
  supportOption: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginBottom: 10, minHeight: 76, paddingHorizontal: 14 },
  supportIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 18, color: '#143A73', fontSize: 20, height: 36, lineHeight: 36, textAlign: 'center', width: 36 },
  supportArrow: { color: '#143A73', fontSize: 25 },
  questionRow: { alignItems: 'center', borderBottomColor: '#D6E4F2', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 52 },
  questionText: { color: '#1B2B40', fontSize: 14 },
  toast: { backgroundColor: '#143A73', borderRadius: 12, marginHorizontal: 24, marginBottom: 8, marginTop: 8, paddingHorizontal: 16, paddingVertical: 11 },
  toastText: { color: '#FFF', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  notificationCard: { alignItems: 'flex-start', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginTop: 12, padding: 14 },
  notificationCardUnread: { backgroundColor: '#F3F8FF', borderColor: '#8FB8E8' },
  notificationIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 18, height: 38, justifyContent: 'center', marginRight: 12, width: 38 },
  notificationCopy: { flex: 1 },
  notificationTitle: { color: '#143A73', fontSize: 15, fontWeight: '800' },
  notificationBody: { color: '#536A86', fontSize: 13, lineHeight: 19, marginTop: 5 },
  notificationTime: { color: '#7D91A8', fontSize: 11, marginTop: 8 },
  notificationUnreadDot: { backgroundColor: '#1B67BA', borderRadius: 5, height: 9, marginLeft: 8, marginTop: 4, width: 9 },
  notificationCountPill: { backgroundColor: '#D9EAFD', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  notificationCountText: { color: '#143A73', fontSize: 12, fontWeight: '800' },
  notificationSetupHint: { backgroundColor: '#FFF8E8', borderRadius: 12, color: '#76520E', fontSize: 13, lineHeight: 19, marginTop: 14, padding: 12 },
  paymentOption: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', marginTop: 10, minHeight: 68, paddingHorizontal: 14 },
  paymentRadioEmpty: { borderColor: '#A8C4E2', borderRadius: 11, borderWidth: 2, height: 22, width: 22 },
  selectedPayment: { backgroundColor: '#D5F0FF', borderColor: '#8FB8E8' },
  paymentIcon: { color: '#143A73', fontSize: 22, width: 30 },
  paymentSetupNotice: { alignItems: 'flex-start', backgroundColor: '#FFF8E8', borderColor: '#F0D8A5', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 16, padding: 14 },
  paymentSetupNoticeText: { color: '#76520E', flex: 1, fontSize: 13, lineHeight: 19 },
  radioLabel: { color: '#143A73', fontSize: 20, fontWeight: '800' },
  totalCard: { alignItems: 'center', borderTopColor: '#D6E4F2', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingTop: 18 },
  totalValue: { color: '#143A73', fontSize: 20, fontWeight: '800' },
  checkoutCostCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, marginTop: 22, padding: 16 },
  checkoutCostTitle: { color: '#143A73', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  checkoutCostRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 42 },
  checkoutCostLabel: { color: '#536A86', flex: 1, fontSize: 14 },
  checkoutCostValue: { color: '#1B2B40', fontSize: 14, fontWeight: '700' },
  checkoutFeeCopy: { flex: 1 },
  checkoutFeeHint: { color: '#7D91A8', fontSize: 11, lineHeight: 16, marginTop: 2 },
  checkoutGrandTotal: { borderTopColor: '#D6E4F2', borderTopWidth: 1, marginTop: 7, paddingTop: 8 },
  checkoutGrandTotalLabel: { color: '#143A73', flex: 1, fontSize: 16, fontWeight: '800' },
  checkoutGrandTotalValue: { color: '#143A73', fontSize: 19, fontWeight: '800' },
  metricsRow: { flexDirection: 'row', gap: 12, marginTop: 28 },
  metric: { backgroundColor: '#D9EAFD', borderRadius: 16, flex: 1, minHeight: 88, justifyContent: 'center', paddingHorizontal: 15 },
  metricValue: { color: '#143A73', fontSize: 24, fontWeight: '800' },
  metricLabel: { color: '#536A86', fontSize: 12, marginTop: 5 },
  quickActions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  quickAction: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 82, justifyContent: 'center' },
  quickActionIcon: { color: '#143A73', fontSize: 24, fontWeight: '700' },
  quickActionText: { color: '#143A73', fontSize: 12, fontWeight: '700', marginTop: 6 },
  sellerOrder: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, minHeight: 68, paddingHorizontal: 14 },
  statusPill: { backgroundColor: '#D9EAFD', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  statusPillText: { color: '#143A73', fontSize: 11, fontWeight: '700' },
  signOutButton: { alignItems: 'center', marginTop: 26, paddingVertical: 12 },
  signOutText: { color: '#B14C4C', fontSize: 14, fontWeight: '600' },
  deliveryStatusCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 28, padding: 16 },
  deliveryStatus: { color: '#143A73', fontSize: 20, fontWeight: '800', marginTop: 4 },
  adminCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, minHeight: 76, paddingHorizontal: 14 },
  adminPanel: { alignSelf: 'center', maxWidth: 1040, width: '100%' },
  adminHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16 },
  adminHeaderCopy: { flex: 1, minWidth: 220, paddingRight: 12 },
  adminEyebrow: { color: '#0F6B46', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  adminTitle: { color: '#143A73', fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
  adminSubtitle: { color: '#536A86', fontSize: 13, lineHeight: 19, marginTop: 4 },
  adminHeaderActions: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  adminIconButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 11, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  adminSignOutButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#E7D2D2', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 40, paddingHorizontal: 11 },
  adminSignOutText: { color: '#9C3D3D', fontSize: 12, fontWeight: '700' },
  adminTabBar: { marginHorizontal: -8, marginTop: 20 },
  adminTabScroll: { gap: 8, paddingHorizontal: 8, paddingBottom: 4 },
  adminTab: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 42, paddingHorizontal: 12 },
  adminTabActive: { backgroundColor: '#0F3D6E', borderColor: '#0F3D6E' },
  adminTabText: { color: '#536A86', fontSize: 12, fontWeight: '700' },
  adminTabTextActive: { color: '#FFF' },
  adminSearchBox: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 18, minHeight: 46, paddingHorizontal: 12 },
  adminSearchInput: { color: '#1B2B40', flex: 1, fontSize: 14, height: 44 },
  adminMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  adminMetricCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 15, borderWidth: 1, flexGrow: 1, flexBasis: 140, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', minHeight: 82, padding: 14 },
  adminMetricLabel: { color: '#536A86', flexBasis: '75%', fontSize: 12, fontWeight: '700' },
  adminMetricValue: { color: '#143A73', flexBasis: '75%', fontSize: 25, fontWeight: '800', marginTop: 6 },
  adminAttentionCard: { alignItems: 'center', backgroundColor: '#FFF9F1', borderColor: '#F1D9B6', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 11, marginTop: 14, padding: 14 },
  adminAttentionIcon: { alignItems: 'center', backgroundColor: '#FCE8D9', borderRadius: 12, height: 40, justifyContent: 'center', width: 40 },
  adminAttentionCopy: { flex: 1 },
  adminAttentionTitle: { color: '#1B2B40', fontSize: 14, fontWeight: '800' },
  adminAttentionSubtitle: { color: '#7A5A36', fontSize: 12, marginTop: 3 },
  adminSectionHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 },
  adminSectionTitle: { color: '#1B2B40', fontSize: 17, fontWeight: '800' },
  adminSeeAll: { color: '#0F3D6E', fontSize: 12, fontWeight: '800' },
  adminCount: { color: '#6B7F99', fontSize: 11, fontWeight: '600' },
  adminListCard: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginTop: 8, minHeight: 68, paddingHorizontal: 13, paddingVertical: 11 },
  adminIssueContent: { flex: 1, minWidth: 0 },
  adminIssueActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  adminListMain: { flex: 1, minWidth: 0 },
  adminListEnd: { alignItems: 'flex-end', gap: 6, maxWidth: 140 },
  adminListTitle: { color: '#1B2B40', fontSize: 13, fontWeight: '800' },
  adminListSub: { color: '#6B7F99', fontSize: 11, lineHeight: 16, marginTop: 3 },
  adminListDate: { color: '#7D91A8', fontSize: 10, marginTop: 4 },
  adminListAmount: { color: '#143A73', fontSize: 12, fontWeight: '800' },
  adminStatusPill: { alignSelf: 'flex-start', borderRadius: 999, maxWidth: 130, paddingHorizontal: 8, paddingVertical: 5 },
  adminStatusPositive: { backgroundColor: '#E4F4EC' },
  adminStatusPending: { backgroundColor: '#FFF1D6' },
  adminStatusNeutral: { backgroundColor: '#EAF0F8' },
  adminStatusText: { fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  adminStatusPositiveText: { color: '#0F6B46' },
  adminStatusPendingText: { color: '#98651A' },
  adminStatusNeutralText: { color: '#536A86' },
  adminVerificationHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  adminHelper: { color: '#536A86', fontSize: 12, lineHeight: 18, marginBottom: 6 },
  adminSubheading: { color: '#536A86', fontSize: 13, fontWeight: '800', marginTop: 22 },
  adminProductAction: { alignItems: 'center', borderColor: '#C9DBF3', borderRadius: 9, borderWidth: 1, marginTop: 4, paddingHorizontal: 11, paddingVertical: 7 },
  adminProductActionText: { color: '#0F3D6E', fontSize: 11, fontWeight: '800' },
  adminLoading: { color: '#536A86', fontSize: 13, marginTop: 18, textAlign: 'center' },
  adminEmpty: { color: '#6B7F99', fontSize: 13, marginTop: 16, textAlign: 'center' },
  verificationRequestCard: { backgroundColor: '#FFF', borderColor: '#C9DBF3', borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 14 },
  verificationDocumentRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  verificationDocumentImage: { backgroundColor: '#EAF3FF', borderRadius: 10, height: 100, width: '48%' },
  verificationDocumentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  verificationDocumentCard: { backgroundColor: '#F7FAFF', borderRadius: 10, flexBasis: '48%', flexGrow: 1, overflow: 'hidden' },
  verificationDocumentImageLarge: { backgroundColor: '#EAF3FF', height: 140, width: '100%' },
  verificationDocumentLabel: { color: '#536A86', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 6 },
  adminMissingDocuments: { color: '#9C3D3D', fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 10 },
  verificationStoreName: { color: '#143A73', fontSize: 17, fontWeight: '800' },
  verificationRequestText: { color: '#536A86', fontSize: 13, lineHeight: 19, marginTop: 6 },
  verificationRequestOwner: { color: '#1B2B40', fontSize: 13, fontWeight: '700', marginTop: 12 },
  verificationContact: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 3 },
  verificationContactText: { color: '#0F3D6E', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  verificationActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  verificationApproveButton: { alignItems: 'center', backgroundColor: '#0F6B46', borderRadius: 11, flex: 1, paddingVertical: 12 },
  verificationApproveText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  verificationRejectButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D6A4A4', borderRadius: 11, borderWidth: 1, flex: 1, paddingVertical: 12 },
  verificationRejectText: { color: '#9C3D3D', fontSize: 14, fontWeight: '800' },
  dashboardNotice: { color: '#143A73', fontSize: 13, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  profileHeader: { alignItems: 'center', flexDirection: 'row', marginTop: 28 },
  avatar: { alignItems: 'center', backgroundColor: '#143A73', borderRadius: 32, height: 64, justifyContent: 'center', marginRight: 14, width: 64 },
  avatarText: { color: '#D5F0FF', fontSize: 28, fontWeight: '800' },
  profileTopBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  profileHero: { alignItems: 'center', backgroundColor: '#143A73', borderRadius: 24, flexDirection: 'row', marginTop: 16, padding: 20 },
  profileAvatarLarge: { alignItems: 'center', backgroundColor: '#D5F0FF', borderColor: '#FFF', borderRadius: 34, borderWidth: 3, height: 68, justifyContent: 'center', marginRight: 16, width: 68 },
  profileAvatarLargeText: { color: '#143A73', fontSize: 30, fontWeight: '800' },
  profileAvatarImage: { borderRadius: 31, height: 62, width: 62 },
  profileAvatarEdit: { alignItems: 'center', backgroundColor: '#0F6B46', borderColor: '#FFF', borderRadius: 12, borderWidth: 1, bottom: -3, height: 24, justifyContent: 'center', position: 'absolute', right: -3, width: 24 },
  profilePhotoAction: { alignSelf: 'flex-start', marginLeft: 12, marginTop: 8, paddingVertical: 6 },
  profilePhotoActionText: { color: '#143A73', fontSize: 13, fontWeight: '700' },
  profileHeroCopy: { flex: 1 },
  profileRoleBadge: { alignSelf: 'flex-start', backgroundColor: '#D9EAFD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  profileRoleBadgeText: { color: '#143A73', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  profileHeroName: { color: '#FFF', fontSize: 21, fontWeight: '800', marginTop: 8 },
  profileHeroEmail: { color: '#D5F0FF', fontSize: 12, marginTop: 4 },
  profileStatsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  profileStatCard: { backgroundColor: '#D9EAFD', borderRadius: 16, flex: 1, minHeight: 76, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  profileStatValue: { color: '#143A73', fontSize: 20, fontWeight: '800' },
  profileStatLabel: { color: '#536A86', fontSize: 11, marginTop: 5 },
  profileSectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginTop: 26 },
  profileSectionTitle: { color: '#1B2B40', fontSize: 20, fontWeight: '800', marginBottom: 10, marginTop: 24 },
  profileInlineAction: { paddingHorizontal: 10, paddingVertical: 8 },
  profileInlineActionText: { color: '#0F3D6E', fontSize: 14, fontWeight: '800' },
  profileDetailsCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 20, borderWidth: 1, padding: 16 },
  payoutAccountCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 },
  payoutAccountHint: { color: '#667C96', fontSize: 12, lineHeight: 18, marginBottom: 8, marginTop: 4 },
  payoutHistory: { borderTopColor: '#D6E4F2', borderTopWidth: 1, marginTop: 14, paddingTop: 12 },
  payoutHistoryTitle: { color: '#143A73', fontSize: 14, fontWeight: '800', marginBottom: 6 },
  payoutHistoryRow: { alignItems: 'center', borderBottomColor: '#E8EFF7', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9 },
  payoutHistoryCopy: { flex: 1, paddingRight: 8 },
  payoutHistoryAmount: { color: '#1B2B40', fontSize: 13, fontWeight: '800' },
  payoutHistoryMeta: { color: '#667C96', fontSize: 11, marginTop: 3 },
  profileDetailRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 56 },
  profileDetailIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  profileDetailGlyph: { color: '#143A73', fontSize: 19, fontWeight: '700' },
  profileDetailCopy: { flex: 1 },
  profileDetailDivider: { backgroundColor: '#E7EEF7', height: 1, marginVertical: 10 },
  profileDetailHint: { color: '#6B7F99', fontSize: 12, lineHeight: 17, marginTop: 4 },
  profileEditActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 12 },
  profileCancelButton: { alignItems: 'center', borderColor: '#A8C4E2', borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 16 },
  profileCancelText: { color: '#143A73', fontSize: 13, fontWeight: '700' },
  profileSaveButton: { alignItems: 'center', backgroundColor: '#0F3D6E', borderRadius: 12, justifyContent: 'center', minHeight: 44, paddingHorizontal: 18 },
  profileSaveText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  profileEditProfileButton: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 13, justifyContent: 'center', marginTop: 16, minHeight: 48, paddingHorizontal: 12 },
  profileEditProfileText: { color: '#143A73', fontSize: 14, fontWeight: '800' },
  profileShortcuts: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 20, borderWidth: 1, marginTop: 2, paddingHorizontal: 14 },
  profileShortcut: { alignItems: 'center', borderBottomColor: '#E7EEF7', borderBottomWidth: 1, flexDirection: 'row', minHeight: 56, paddingHorizontal: 4 },
  profileShortcutIcon: { alignItems: 'center', color: '#143A73', fontSize: 20, fontWeight: '700', textAlign: 'center', width: 32 },
  profileShortcutLabel: { color: '#1B2B40', flex: 1, fontSize: 14, fontWeight: '600', marginLeft: 10 },
  profileShortcutArrow: { color: '#536A86', fontSize: 14, fontWeight: '700' },
  profileSignOutButton: { alignItems: 'center', backgroundColor: '#FFF', borderColor: '#F0D8D8', borderRadius: 15, borderWidth: 1, justifyContent: 'center', marginBottom: 8, marginTop: 20, minHeight: 54 },
  profileSignOutText: { color: '#B14C4C', fontSize: 15, fontWeight: '800' },
  profileName: { color: '#143A73', fontSize: 18, fontWeight: '800' },
  profileEmail: { color: '#6B7F99', fontSize: 13, marginTop: 4 },
  profileCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 14, borderWidth: 1, marginTop: 16, padding: 16 },
  profileLabel: { color: '#6B7F99', fontSize: 12, fontWeight: '600' },
  profileValue: { color: '#1B2B40', fontSize: 16, fontWeight: '700', marginTop: 6 },
  profileAction: { marginTop: 12 },
  profileActionText: { color: '#143A73', fontSize: 13, fontWeight: '700' },
  deliveryHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32, marginTop: 16 },
  deliveryProfileButton: { alignItems: 'center', borderColor: '#BFD2E9', borderRadius: 22, borderWidth: 1.5, height: 44, justifyContent: 'center', width: 44 },
  deliveryProfileIcon: { color: '#143A73', fontSize: 23, lineHeight: 28 },
  deliveryEyebrow: { color: '#6B7F99', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  deliveryHeroTitle: { color: '#143A73', fontSize: 38, fontWeight: '800', letterSpacing: -1.2, marginTop: 14 },
  deliverySubtitle: { color: '#536A86', fontSize: 16, lineHeight: 24, marginTop: 10 },
  riderVerificationPanel: { backgroundColor: '#F2F7FF', borderColor: '#C9DBF3', borderRadius: 15, borderWidth: 1, marginTop: 16, padding: 13 },
  riderVerificationHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  riderVerificationTitle: { color: '#143A73', fontSize: 16, fontWeight: '800' },
  riderVerificationCopy: { color: '#536A86', fontSize: 12, lineHeight: 18, marginTop: 8 },
  deliveryMetrics: { flexDirection: 'row', gap: 12, marginTop: 24 },
  deliveryMetric: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 18, flex: 1, flexDirection: 'row', gap: 12, minHeight: 76, paddingHorizontal: 16 },
  riderEarningsCard: { backgroundColor: '#143A73', borderRadius: 18, marginTop: 14, padding: 16 },
  riderEarningsEyebrow: { color: '#C9DFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  riderEarningsToday: { color: '#FFF', fontSize: 28, fontWeight: '800', marginTop: 6 },
  riderEarningsDetails: { borderTopColor: '#41618B', borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 13, paddingTop: 11 },
  riderEarningsDetail: { flex: 1 },
  riderEarningsAmount: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  riderEarningsLabel: { color: '#D9ECFF', fontSize: 9, lineHeight: 13, marginTop: 4 },
  riderEarningsNote: { color: '#C9DFFF', fontSize: 10, lineHeight: 15, marginTop: 12 },
  deliveryMetricValue: { color: '#143A73', fontSize: 30, fontWeight: '800' },
  deliveryMetricLabel: { color: '#536A86', flex: 1, fontSize: 13, lineHeight: 18 },
  deliverySectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, marginTop: 32 },
  deliverySectionTitle: { color: '#1B2B40', fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 28 },
  deliveryAvailability: { alignItems: 'center', flexDirection: 'row', gap: 6, paddingVertical: 8 },
  deliveryAvailabilityDot: { backgroundColor: '#A8C4E2', borderRadius: 5, height: 9, width: 9 },
  deliveryAvailabilityDotOn: { backgroundColor: '#2D8A59' },
  deliveryAvailabilityText: { color: '#536A86', fontSize: 12, fontWeight: '700' },
  deliveryOrderCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 22, borderWidth: 1, marginTop: 2, padding: 18 },
  deliveryOrderTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  deliveryOrderId: { color: '#1B2B40', fontSize: 18, fontWeight: '800' },
  deliveryStatusPill: { backgroundColor: '#D9EAFD', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  deliveryStatusPillText: { color: '#143A73', fontSize: 12, fontWeight: '800' },
  deliveryAssignmentMeta: { color: '#6B7F99', fontSize: 13, marginTop: 16 },
  deliveryProgress: { flexDirection: 'row', gap: 8, marginTop: 18 },
  deliveryProgressLine: { backgroundColor: '#D6E4F2', borderRadius: 999, flex: 1, height: 5 },
  deliveryProgressActive: { backgroundColor: '#143A73' },
  deliveryProgressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  deliveryProgressLabel: { color: '#536A86', flex: 1, fontSize: 12 },
  deliveryInfoRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, marginTop: 22 },
  deliveryInfoIcon: { alignItems: 'center', backgroundColor: '#D9EAFD', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  deliveryInfoGlyph: { color: '#143A73', fontSize: 24, fontWeight: '700' },
  deliveryInfoCopy: { flex: 1 },
  deliveryInfoEyebrow: { color: '#143A73', fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  deliveryInfoTitle: { color: '#1B2B40', fontSize: 16, fontWeight: '700', marginTop: 5 },
  deliveryInfoBody: { color: '#6B7F99', fontSize: 14, lineHeight: 21, marginTop: 6 },
  deliveryRoute: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  deliveryCheckCard: { backgroundColor: '#EAF3FF', borderRadius: 16, marginTop: 20, padding: 16 },
  deliveryCheckTitle: { color: '#1B2B40', fontSize: 15, fontWeight: '800' },
  deliveryProofImage: { backgroundColor: '#D6E4F2', borderRadius: 14, height: 220, marginTop: 12, width: '100%' },
  deliveryPrimaryButton: { alignItems: 'center', backgroundColor: '#143A73', borderRadius: 15, justifyContent: 'center', marginTop: 16, minHeight: 58, paddingHorizontal: 12 },
  deliveryPrimaryButtonContent: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  deliveryPrimaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  deliveryHint: { color: '#6B7F99', fontSize: 13, lineHeight: 20, marginTop: 14 },
  deliveryEmptyCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, marginTop: 2, padding: 20 },
  deliveryEmptyTitle: { color: '#1B2B40', fontSize: 17, fontWeight: '800' },
  deliveryEmptyText: { color: '#6B7F99', fontSize: 14, lineHeight: 21, marginTop: 6 },
  deliveryCompletedHeading: { marginBottom: 14, marginTop: 34 },
  deliveryCompletedCard: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, marginTop: 12, padding: 16 },
  remittancePanel: { backgroundColor: '#F4F8FD', borderColor: '#D6E4F2', borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 12 },
  remittanceTitle: { color: '#143A73', fontSize: 13, fontWeight: '800' },
  remittanceHint: { color: '#536A86', fontSize: 12, lineHeight: 18, marginTop: 6 },
  remittanceStatus: { color: '#536A86', fontSize: 12, lineHeight: 18, marginTop: 6 },
  deliveryRemitButton: { alignItems: 'center', backgroundColor: '#0F6B46', borderRadius: 11, justifyContent: 'center', marginTop: 8, minHeight: 44, paddingHorizontal: 10 },
  deliveryTabBar: { alignItems: 'center', backgroundColor: '#143A73', flexDirection: 'row', justifyContent: 'space-around', paddingBottom: Platform.OS === 'ios' ? 8 : 10, paddingHorizontal: 12, paddingTop: 12 },
  deliveryTab: { alignItems: 'center', flex: 1, minHeight: 48, justifyContent: 'center' },
  deliveryTabIcon: { color: '#FFF', fontSize: 22, height: 25 },
  deliveryTabLabel: { color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 3 },
  deliveryTabSelected: { color: '#D5F0FF', fontWeight: '800' },
  iosTabBar: { backgroundColor: '#FFF', borderColor: '#D6E4F2', borderRadius: 18, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-around', marginTop: 28, paddingBottom: Platform.OS === 'ios' ? 8 : 4, paddingTop: 8 },
  iosTab: { alignItems: 'center', flex: 1, minHeight: 45, paddingHorizontal: 2 },
  iosTabIcon: { color: '#7D91A8', fontSize: 19, height: 23 },
  iosTabLabel: { color: '#7D91A8', fontSize: 9, marginTop: 2, textAlign: 'center' },
  iosTabActive: { color: '#143A73', fontWeight: '700' },
});
