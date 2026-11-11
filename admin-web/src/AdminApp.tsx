import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { supabase, supabaseConfigured } from './supabase';

type Tab = 'overview' | 'orders' | 'stores' | 'products' | 'people' | 'payouts';
type PeopleRoleFilter = 'all' | 'buyer' | 'seller' | 'delivery';
type RiderFilter = 'all' | 'available' | 'offline' | 'verified' | 'needs-review';
type IconName = 'overview' | 'orders' | 'stores' | 'products' | 'people' | 'payouts' | 'check' | 'arrow-right' | 'refresh' | 'search' | 'external';
type FinanceData = {
  collection_account: { bank_name: string; account_name: string; account_number: string } | null;
  payouts: Array<{
    id: string;
    order_id: string;
    beneficiary_id: string;
    payout_type: 'seller' | 'rider';
    amount: number;
    status: string;
    transfer_reference: string | null;
    created_at: string;
    beneficiary_name: string;
    beneficiary_email: string;
    store_names: string;
    bank_name: string | null;
    account_name: string | null;
    account_number: string | null;
    remittance_status: string;
  }>;
  remittances: Array<{
    id: string;
    order_id: string;
    rider_id: string;
    rider_name: string;
    rider_email: string;
    expected_amount: number;
    transfer_reference: string;
    status: string;
    submitted_at: string;
  }>;
};
type StoreRequest = {
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
type RiderRequest = {
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
type Snapshot = {
  metrics: {
    buyers: number;
    stores: number;
    pending_verification: number;
    pending_rider_verification: number;
    live_orders: number;
    available_riders: number;
  };
  orders: Array<{
    id: string;
    status: string;
    total: number;
    payment_method: string;
    delivery_address: string;
    created_at: string;
    buyer_name: string;
    rider_name: string;
    item_count: number;
  }>;
  stores: Array<{
    id: string;
    name: string;
    category: string;
    market_area: string;
    owner_name: string;
    product_count: number;
    verification_status: string;
    created_at: string;
  }>;
  products: Array<{
    id: string;
    name: string;
    category: string;
    price: number;
    unit: string;
    stock_quantity: number;
    is_available: boolean;
    store_name: string;
  }>;
  users: Array<{ id: string; full_name: string; role: string; area: string; created_at: string }>;
  delivery_partners: Array<{
    id: string;
    full_name: string;
    vehicle_type: string;
    is_available: boolean;
    verification_status: string;
    plate_number: string | null;
  }>;
};

const tabs: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'orders', label: 'Orders', icon: 'orders' },
  { id: 'stores', label: 'Stores', icon: 'stores' },
  { id: 'products', label: 'Products', icon: 'products' },
  { id: 'people', label: 'People & riders', icon: 'people' },
  { id: 'payouts', label: 'Payouts', icon: 'payouts' },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
    orders: <><path d="M8 3h8l4 4v14H4V3z" /><path d="M8 3v5h5M8 12h8M8 16h8" /></>,
    stores: <><path d="M3 10h18l-1.5-6h-15z" /><path d="M5 10v10h14V10M9 20v-6h6v6M3 10c0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0" /></>,
    products: <><path d="m12 3 9 5v8l-9 5-9-5V8z" /><path d="m3.5 8.5 8.5 5 8.5-5M12 13.5V21M7.5 5.5l9 5" /></>,
    people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 6.8M18 14a5.5 5.5 0 0 1 3.5 5.2" /></>,
    payouts: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /><circle cx="16.5" cy="14.5" r="1.5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    'arrow-right': <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.6-2.6L20 12M4 12l2.9 5.6A7 7 0 0 0 18.5 15" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const details = 'details' in error && typeof error.details === 'string' ? ` ${error.details}` : '';
    const hint = 'hint' in error && typeof error.hint === 'string' ? ` ${error.hint}` : '';
    return `${error.message}${details}${hint}`;
  }
  return 'An unexpected error occurred. Please try again.';
}

function money(amount: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(amount);
}

function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = ['verified', 'completed', 'available', 'listed', 'ready', 'confirmed', 'paid', 'remittance confirmed', 'payment verified'].includes(normalized)
    ? 'green'
    : ['pending', 'pending review', 'preparing', 'accepted', 'waiting for remittance', 'waiting for buyer confirmation'].includes(normalized)
      ? 'amber'
      : 'gray';
  return <span className={`status status-${tone}`}>{value.replaceAll('_', ' ')}</span>;
}

function RoleBadge({ role }: { role: string }) {
  const label = role === 'delivery' ? 'Rider' : role === 'admin' ? 'Admin' : role === 'seller' ? 'Seller' : 'Buyer';
  return <span className={`role-badge role-badge-${role}`}>{label}</span>;
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [peopleRoleFilter, setPeopleRoleFilter] = useState<PeopleRoleFilter>('all');
  const [riderFilter, setRiderFilter] = useState<RiderFilter>('all');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [storeRequests, setStoreRequests] = useState<StoreRequest[]>([]);
  const [riderRequests, setRiderRequests] = useState<RiderRequest[]>([]);
  const [finance, setFinance] = useState<FinanceData>({ collection_account: null, payouts: [], remittances: [] });
  const [transferReferences, setTransferReferences] = useState<Record<string, string>>({});
  const [collectionBankName, setCollectionBankName] = useState('');
  const [collectionAccountName, setCollectionAccountName] = useState('');
  const [collectionAccountNumber, setCollectionAccountNumber] = useState('');
  const [collectionAccountNotice, setCollectionAccountNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');

  const authorize = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setAuthorized(false);
    if (!nextSession) {
      setCheckingRole(false);
      return;
    }

    setCheckingRole(true);
    const { data, error: roleError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', nextSession.user.id)
      .single();
    if (roleError || data?.role !== 'admin') {
      await supabase.auth.signOut();
      setSession(null);
      setError(roleError ? `Unable to confirm admin access: ${roleError.message}` : 'This account does not have administrator access.');
      setCheckingRole(false);
      return;
    }

    setError('');
    setAuthorized(true);
    setCheckingRole(false);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) throw sessionError;
      if (active) void authorize(data.session);
    }).catch((sessionError: unknown) => {
      if (active) {
        setError(messageOf(sessionError));
        setCheckingRole(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) void authorize(nextSession);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [authorize]);

  const loadDashboard = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    setError('');
    try {
      const [
        { data: snapshotData, error: snapshotError },
        { data: storeData, error: storeError },
        { data: riderData, error: riderError },
        { data: financeData, error: financeError },
      ] = await Promise.all([
        supabase.rpc('get_admin_dashboard_snapshot'),
        supabase.rpc('get_store_verification_queue'),
        supabase.rpc('get_rider_verification_queue'),
        supabase.rpc('get_admin_finance_dashboard'),
      ]);
      if (snapshotError) throw snapshotError;
      if (storeError) throw storeError;
      if (riderError) throw riderError;
      if (financeError) throw financeError;
      if (!snapshotData || typeof snapshotData !== 'object') throw new Error('Admin dashboard returned an invalid response.');
      if (!financeData || typeof financeData !== 'object') throw new Error('Admin finance dashboard returned an invalid response.');

      const signedUrl = async (path: string | null) => {
        if (!path) return undefined;
        const { data, error: urlError } = await supabase.storage
          .from('verification-documents')
          .createSignedUrl(path, 600);
        if (urlError) throw urlError;
        return data.signedUrl;
      };
      const [signedStores, signedRiders] = await Promise.all([
        Promise.all(((storeData || []) as StoreRequest[]).map(async (request) => ({
          ...request,
          storefront_photo_url: await signedUrl(request.storefront_photo_path),
          seller_id_url: await signedUrl(request.seller_id_path),
        }))),
        Promise.all(((riderData || []) as RiderRequest[]).map(async (request) => ({
          ...request,
          plate_photo_url: await signedUrl(request.plate_photo_path),
          roadworthiness_photo_url: await signedUrl(request.roadworthiness_photo_path),
          driver_license_photo_url: await signedUrl(request.driver_license_photo_path),
        }))),
      ]);
      setSnapshot(snapshotData as Snapshot);
      setStoreRequests(signedStores);
      setRiderRequests(signedRiders);
      setFinance(financeData as FinanceData);
      const collectionAccount = (financeData as FinanceData).collection_account;
      setCollectionBankName(collectionAccount?.bank_name || '');
      setCollectionAccountName(collectionAccount?.account_name || '');
      setCollectionAccountNumber(collectionAccount?.account_number || '');
    } catch (loadError: unknown) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
    }
  }, [authorized]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!supabaseConfigured) {
      setError('Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in the root .env.local file first.');
      return;
    }
    setSigningIn(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      await authorize(data.session);
    } catch (signInError: unknown) {
      setError(messageOf(signInError));
    } finally {
      setSigningIn(false);
    }
  };

  const review = async (id: string, kind: 'store' | 'rider', approved: boolean) => {
    setBusyId(id);
    setError('');
    try {
      const result = kind === 'store'
        ? await supabase.rpc('review_store_verification', { p_store_id: id, p_approved: approved })
        : await supabase.rpc('review_rider_verification', { p_verification_id: id, p_approved: approved });
      if (result.error) throw result.error;
      await loadDashboard();
    } catch (reviewError: unknown) {
      setError(messageOf(reviewError));
    } finally {
      setBusyId('');
    }
  };

  const moderateProduct = async (product: Snapshot['products'][number]) => {
    setBusyId(product.id);
    setError('');
    try {
      const { error: updateError } = await supabase.rpc('admin_set_product_availability', {
        p_product_id: product.id,
        p_is_available: !product.is_available,
      });
      if (updateError) throw updateError;
      await loadDashboard();
    } catch (updateError: unknown) {
      setError(messageOf(updateError));
    } finally {
      setBusyId('');
    }
  };

  const reviewRemittance = async (id: string, approved: boolean) => {
    setBusyId(id);
    setError('');
    try {
      const { error: reviewError } = await supabase.rpc('admin_review_cod_remittance', {
        p_remittance_id: id,
        p_approved: approved,
      });
      if (reviewError) throw reviewError;
      await loadDashboard();
    } catch (reviewError: unknown) {
      setError(messageOf(reviewError));
    } finally {
      setBusyId('');
    }
  };

  const payPayout = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      const { error: payoutError } = await supabase.rpc('admin_mark_payout_paid', {
        p_payout_id: id,
        p_transfer_reference: transferReferences[id] || '',
      });
      if (payoutError) throw payoutError;
      await loadDashboard();
    } catch (payoutError: unknown) {
      setError(messageOf(payoutError));
    } finally {
      setBusyId('');
    }
  };

  const saveCollectionAccount = async () => {
    setError('');
    setCollectionAccountNotice('');
    setBusyId('collection-account');
    try {
      const { error: saveError } = await supabase.rpc('admin_save_cod_collection_account', {
        p_bank_name: collectionBankName,
        p_account_name: collectionAccountName,
        p_account_number: collectionAccountNumber,
      });
      if (saveError) throw saveError;
      const { data, error: loadError } = await supabase.rpc('get_admin_finance_dashboard');
      if (loadError) throw loadError;
      if (!data || typeof data !== 'object') throw new Error('Collection account was saved, but the finance dashboard returned invalid data. Refresh to confirm the saved values.');
      const financeData = data as FinanceData;
      setFinance(financeData);
      setCollectionBankName(financeData.collection_account?.bank_name || '');
      setCollectionAccountName(financeData.collection_account?.account_name || '');
      setCollectionAccountNumber(financeData.collection_account?.account_number || '');
      setCollectionAccountNotice('GetBuy collection account saved and loaded successfully.');
    } catch (saveError: unknown) {
      const code = saveError && typeof saveError === 'object' && 'code' in saveError
        ? String(saveError.code)
        : '';
      const detail = messageOf(saveError);
      setError(
        code === 'PGRST202' || code === '42883'
          ? 'Supabase payout setup is incomplete: admin_save_cod_collection_account was not found. Apply the complete marketplace payout migration as postgres, then reload this admin page.'
          : detail,
      );
    } finally {
      setBusyId('');
    }
  };

  const filtered = useMemo(() => {
    if (!snapshot) return { orders: [], stores: [], products: [], users: [], payouts: [] };
    const query = search.trim().toLowerCase();
    return {
      orders: snapshot.orders.filter((row) => `${row.id} ${row.status} ${row.buyer_name} ${row.delivery_address}`.toLowerCase().includes(query)),
      stores: snapshot.stores.filter((row) => `${row.name} ${row.category} ${row.market_area} ${row.owner_name} ${row.verification_status}`.toLowerCase().includes(query)),
      products: snapshot.products.filter((row) => `${row.name} ${row.category} ${row.store_name}`.toLowerCase().includes(query)),
      users: snapshot.users.filter((row) => `${row.full_name} ${row.role} ${row.area}`.toLowerCase().includes(query)),
      payouts: finance.payouts.filter((row) => `${row.order_id} ${row.beneficiary_name} ${row.beneficiary_email} ${row.payout_type}`.toLowerCase().includes(query)),
    };
  }, [finance.payouts, search, snapshot]);
  const peopleCounts = useMemo(() => {
    const users = snapshot?.users || [];
    return {
      all: users.length,
      buyer: users.filter((user) => user.role === 'buyer').length,
      seller: users.filter((user) => user.role === 'seller').length,
      delivery: users.filter((user) => user.role === 'delivery').length,
    };
  }, [snapshot]);
  const filteredPeople = useMemo(
    () => filtered.users.filter((user) => peopleRoleFilter === 'all' || user.role === peopleRoleFilter),
    [filtered.users, peopleRoleFilter],
  );
  const filteredRiders = useMemo(() => {
    const riders = snapshot?.delivery_partners || [];
    const query = search.trim().toLowerCase();
    return riders.filter((rider) => {
      const matchesSearch = `${rider.full_name} ${rider.vehicle_type} ${rider.plate_number || ''} ${rider.verification_status}`.toLowerCase().includes(query);
      const matchesFilter = riderFilter === 'all'
        || (riderFilter === 'available' && rider.is_available)
        || (riderFilter === 'offline' && !rider.is_available)
        || (riderFilter === 'verified' && rider.verification_status === 'verified')
        || (riderFilter === 'needs-review' && ['pending', 'unverified', 'rejected'].includes(rider.verification_status));
      return matchesSearch && matchesFilter;
    });
  }, [riderFilter, search, snapshot]);

  if (!supabaseConfigured) {
    return <Login error="Supabase is not configured. Add the public Supabase URL and anon key to the root .env.local file." />;
  }
  if (checkingRole) return <div className="loading-screen"><div className="spinner" /><span>Checking administrator access…</span></div>;
  if (!session || !authorized) return <Login email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={signIn} loading={signingIn} error={error} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="GetBuy Admin home"><span className="brand-mark">G</span><span>getBuy<span className="brand-light"> admin</span></span></a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Admin sections">
          {tabs.map((item) => (
            <button key={item.id} className={`nav-item ${tab === item.id ? 'nav-item-active' : ''}`} onClick={() => { setTab(item.id); setSearch(''); }}>
              <span className="nav-icon"><Icon name={item.icon} /></span><span>{item.label}</span>
              {item.id === 'stores' && (snapshot?.metrics.pending_verification || 0) > 0 ? <span className="nav-count">{snapshot?.metrics.pending_verification}</span> : null}
              {item.id === 'people' && (snapshot?.metrics.pending_rider_verification || 0) > 0 ? <span className="nav-count">{snapshot?.metrics.pending_rider_verification}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip"><span className="avatar">{(session.user.email || 'A')[0].toUpperCase()}</span><span className="user-details"><b>Administrator</b><small>{session.user.email}</small></span></div>
          <button className="sign-out" onClick={() => { void supabase.auth.signOut(); }}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">GetBuy <span>/</span> Admin <span>/</span> <b>{tabs.find((item) => item.id === tab)?.label}</b></div>
          <div className="topbar-actions"><span className="secure-label"><span /> Admin-only workspace</span><button className="button button-outline" disabled={loading} onClick={() => void loadDashboard()}><Icon name="refresh" />{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        </header>
        <div className="content">
          <div className="page-heading"><div><p className="eyebrow">GETBUY OPERATIONS</p><h1>{tab === 'overview' ? 'Marketplace overview' : tabs.find((item) => item.id === tab)?.label}</h1><p className="muted">Manage marketplace activity from one secure workspace.</p></div><div className="date-label">{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div></div>
          {error ? <div className="alert" role="alert">{error}</div> : null}
          {loading && !snapshot ? <div className="empty-panel">Loading marketplace data…</div> : null}

          {tab === 'overview' && snapshot ? (
            <>
              <div className="metric-grid">
                <MetricCard label="Live orders" value={snapshot.metrics.live_orders} icon="orders" accent="blue" />
                <MetricCard label="Stores" value={snapshot.metrics.stores} icon="stores" accent="green" />
                <MetricCard label="Buyers" value={snapshot.metrics.buyers} icon="people" accent="purple" />
                <MetricCard label="Verified riders online" value={snapshot.metrics.available_riders} icon="people" accent="amber" />
              </div>
              <div className="attention-grid">
                <button className="attention-card" onClick={() => setTab('stores')}><span className="attention-icon amber"><Icon name="check" /></span><span><b>Store verification</b><small>{snapshot.metrics.pending_verification} waiting for review</small></span><i><Icon name="arrow-right" /></i></button>
                <button className="attention-card" onClick={() => setTab('people')}><span className="attention-icon blue"><Icon name="people" /></span><span><b>Rider verification</b><small>{snapshot.metrics.pending_rider_verification} waiting for review</small></span><i><Icon name="arrow-right" /></i></button>
              </div>
              <section className="panel"><div className="section-heading"><div><h2>Recent orders</h2><p>Latest activity across the marketplace</p></div><button className="text-button" onClick={() => setTab('orders')}>View all <Icon name="arrow-right" /></button></div><OrderTable rows={snapshot.orders.slice(0, 8)} /></section>
            </>
          ) : null}

          {tab !== 'overview' ? <div className="search-bar"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${tab === 'people' ? 'people and riders' : tab}…`} /></div> : null}

          {tab === 'orders' && snapshot ? <section className="panel"><div className="section-heading"><div><h2>Orders</h2><p>Showing latest {filtered.orders.length} orders</p></div></div><OrderTable rows={filtered.orders} /></section> : null}

          {tab === 'stores' && snapshot ? (
            <>
              <section className="panel"><div className="section-heading"><div><h2>Verification requests</h2><p>Review the store details and submitted images before approval.</p></div><Status value={`${storeRequests.length} pending`} /></div>
                {storeRequests.filter((row) => `${row.store_name} ${row.owner_name} ${row.market_area}`.toLowerCase().includes(search.toLowerCase())).map((request) => (
                  <article className="review-card" key={request.store_id}>
                    <div className="review-card-heading"><div><h3>{request.store_name}</h3><p>{request.category} · {request.market_area}</p></div><Status value="pending review" /></div>
                    <p className="review-detail"><b>Pickup:</b> {request.pickup_details}</p>{request.description ? <p className="review-detail">{request.description}</p> : null}
                    <p className="review-detail"><b>Owner:</b> {request.owner_name} · <a href={`mailto:${request.owner_email}`}>{request.owner_email}</a></p>
                    <div className="document-grid">{request.storefront_photo_url ? <Document label="Storefront or stall" url={request.storefront_photo_url} /> : null}{request.seller_id_url ? <Document label="Seller identity" url={request.seller_id_url} /> : null}</div>
                    {!request.storefront_photo_url || !request.seller_id_url ? <p className="missing-document">Required images are missing; ask the seller to resubmit.</p> : null}
                    <div className="review-actions"><button className="button button-success" disabled={busyId === request.store_id || !request.storefront_photo_url || !request.seller_id_url} onClick={() => void review(request.store_id, 'store', true)}>{busyId === request.store_id ? 'Saving…' : 'Approve store'}</button><button className="button button-danger" disabled={busyId === request.store_id} onClick={() => void review(request.store_id, 'store', false)}>Reject</button></div>
                  </article>
                ))}
                {storeRequests.length === 0 ? <Empty>No store requests are waiting for review.</Empty> : null}
              </section>
              <section className="panel"><div className="section-heading"><div><h2>All stores</h2><p>{filtered.stores.length} shown · latest 100</p></div></div><div className="table-wrap"><table><thead><tr><th>STORE</th><th>OWNER</th><th>AREA</th><th>PRODUCTS</th><th>VERIFICATION</th></tr></thead><tbody>{filtered.stores.map((row) => <tr key={row.id}><td><b>{row.name}</b><small>{row.category}</small></td><td>{row.owner_name}</td><td>{row.market_area || '—'}</td><td>{row.product_count}</td><td><Status value={row.verification_status} /></td></tr>)}</tbody></table>{filtered.stores.length === 0 ? <Empty>No matching stores.</Empty> : null}</div></section>
            </>
          ) : null}

          {tab === 'products' && snapshot ? <section className="panel"><div className="section-heading"><div><h2>Product catalog</h2><p>Hide inappropriate listings or restore products with stock.</p></div></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>STORE</th><th>PRICE</th><th>STOCK</th><th>STATUS</th><th /></tr></thead><tbody>{filtered.products.map((product) => <tr key={product.id}><td><b>{product.name}</b><small>{product.category}</small></td><td>{product.store_name}</td><td>{money(Number(product.price))} / {product.unit}</td><td>{product.stock_quantity}</td><td><Status value={product.is_available ? 'listed' : 'hidden'} /></td><td><button className="table-action" disabled={busyId === product.id || (!product.is_available && Number(product.stock_quantity) <= 0)} onClick={() => void moderateProduct(product)}>{busyId === product.id ? 'Saving…' : product.is_available ? 'Hide' : 'Restore'}</button></td></tr>)}</tbody></table>{filtered.products.length === 0 ? <Empty>No matching products.</Empty> : null}</div></section> : null}

          {tab === 'people' && snapshot ? (
            <>
              <section className="panel"><div className="section-heading"><div><h2>Rider verification</h2><p>Check the plate against the rider’s licence and current roadworthiness document.</p></div><Status value={`${riderRequests.length} pending`} /></div>
                {riderRequests.filter((row) => `${row.rider_name} ${row.rider_email} ${row.plate_number}`.toLowerCase().includes(search.toLowerCase())).map((request) => (
                  <article className="review-card" key={request.verification_id}>
                    <div className="review-card-heading"><div><h3>{request.rider_name || 'Delivery partner'}</h3><p>Plate number: <b>{request.plate_number}</b> · <a href={`mailto:${request.rider_email}`}>{request.rider_email}</a></p></div><Status value="pending review" /></div>
                    <div className="document-grid three">{request.plate_photo_url ? <Document label="Number plate" url={request.plate_photo_url} /> : null}{request.roadworthiness_photo_url ? <Document label="Roadworthiness" url={request.roadworthiness_photo_url} /> : null}{request.driver_license_photo_url ? <Document label="Driver licence" url={request.driver_license_photo_url} /> : null}</div>
                    {!request.plate_photo_url || !request.roadworthiness_photo_url || !request.driver_license_photo_url ? <p className="missing-document">Required images are missing; do not approve.</p> : null}
                    <div className="review-actions"><button className="button button-success" disabled={busyId === request.verification_id || !request.plate_photo_url || !request.roadworthiness_photo_url || !request.driver_license_photo_url} onClick={() => void review(request.verification_id, 'rider', true)}>{busyId === request.verification_id ? 'Saving…' : 'Approve rider'}</button><button className="button button-danger" disabled={busyId === request.verification_id} onClick={() => void review(request.verification_id, 'rider', false)}>Reject</button></div>
                  </article>
                ))}
                {riderRequests.length === 0 ? <Empty>No rider requests are waiting for review.</Empty> : null}
              </section>
              <section className="panel">
                <div className="section-heading"><div><h2>Rider dashboard</h2><p>Delivery partner accounts, verification, and live availability</p></div><Status value={`${filteredRiders.length} shown`} /></div>
                <div className="role-filter-row" aria-label="Filter riders">
                  {([
                    ['all', `All riders · ${snapshot.delivery_partners.length}`],
                    ['available', `Online · ${snapshot.delivery_partners.filter((rider) => rider.is_available).length}`],
                    ['offline', `Offline · ${snapshot.delivery_partners.filter((rider) => !rider.is_available).length}`],
                    ['verified', `Verified · ${snapshot.delivery_partners.filter((rider) => rider.verification_status === 'verified').length}`],
                    ['needs-review', `Needs review · ${snapshot.delivery_partners.filter((rider) => ['pending', 'unverified', 'rejected'].includes(rider.verification_status)).length}`],
                  ] as const).map(([value, label]) => (
                    <button key={value} className={`role-filter ${riderFilter === value ? 'role-filter-active' : ''}`} onClick={() => setRiderFilter(value)}>{label}</button>
                  ))}
                </div>
                <div className="table-wrap"><table><thead><tr><th>RIDER</th><th>ROLE</th><th>VEHICLE</th><th>PLATE</th><th>VERIFICATION</th><th>AVAILABILITY</th></tr></thead><tbody>{filteredRiders.map((rider) => <tr key={rider.id}><td><b>{rider.full_name}</b></td><td><RoleBadge role="delivery" /></td><td>{rider.vehicle_type || '—'}</td><td>{rider.plate_number || '—'}</td><td><Status value={rider.verification_status} /></td><td><Status value={rider.is_available ? 'available' : 'offline'} /></td></tr>)}</tbody></table>{filteredRiders.length === 0 ? <Empty>No riders match this filter.</Empty> : null}</div>
              </section>
              <section className="panel">
                <div className="section-heading"><div><h2>People by account type</h2><p>Showing the latest 100 accounts. Use a category to distinguish buyers, sellers, and riders.</p></div><Status value={`${filteredPeople.length} shown`} /></div>
                <div className="role-filter-row" aria-label="Filter people by role">
                  {([
                    ['all', `Everyone · ${peopleCounts.all}`],
                    ['buyer', `Buyers · ${peopleCounts.buyer}`],
                    ['seller', `Sellers · ${peopleCounts.seller}`],
                    ['delivery', `Riders · ${peopleCounts.delivery}`],
                  ] as const).map(([value, label]) => (
                    <button key={value} className={`role-filter ${peopleRoleFilter === value ? 'role-filter-active' : ''}`} onClick={() => setPeopleRoleFilter(value)}>{label}</button>
                  ))}
                </div>
                <div className="table-wrap"><table><thead><tr><th>NAME</th><th>ACCOUNT TYPE</th><th>AREA</th><th>JOINED</th></tr></thead><tbody>{filteredPeople.map((user) => <tr key={user.id}><td><b>{user.full_name || 'Unnamed account'}</b></td><td><RoleBadge role={user.role} /></td><td>{user.area || '—'}</td><td>{new Date(user.created_at).toLocaleDateString()}</td></tr>)}</tbody></table>{filteredPeople.length === 0 ? <Empty>No accounts match this role and search.</Empty> : null}</div>
              </section>
            </>
          ) : null}
          {tab === 'payouts' ? (
            <>
              <section className="panel">
                <div className="section-heading"><div><h2>GetBuy COD collection account</h2><p>Riders transfer the full cash collected from buyers to this account.</p></div></div>
                {collectionAccountNotice ? <div className="success-notice" role="status">{collectionAccountNotice}</div> : null}
                <div className="collection-account-form">
                  <label>Bank name<input value={collectionBankName} onChange={(event) => setCollectionBankName(event.target.value)} placeholder="Bank name" /></label>
                  <label>Account holder<input value={collectionAccountName} onChange={(event) => setCollectionAccountName(event.target.value)} placeholder="Business account name" /></label>
                  <label>10-digit account number<input inputMode="numeric" value={collectionAccountNumber} onChange={(event) => setCollectionAccountNumber(event.target.value)} placeholder="0123456789" /></label>
                  <button className="button button-primary" disabled={busyId === 'collection-account'} onClick={() => void saveCollectionAccount()}>{busyId === 'collection-account' ? 'Saving…' : 'Save collection account'}</button>
                </div>
              </section>
              <section className="panel">
                <div className="section-heading"><div><h2>Cash remittances</h2><p>Confirm the rider’s transfer of the full cash collected from each buyer.</p></div><Status value={`${finance.remittances.length} awaiting review`} /></div>
                {finance.remittances.filter((row) => `${row.order_id} ${row.rider_name} ${row.rider_email} ${row.transfer_reference}`.toLowerCase().includes(search.toLowerCase())).map((row) => (
                  <article className="review-card" key={row.id}>
                    <div className="review-card-heading"><div><h3>Order #{row.order_id.slice(0, 8).toUpperCase()} · {money(Number(row.expected_amount))}</h3><p>Rider: {row.rider_name} · <a href={`mailto:${row.rider_email}`}>{row.rider_email}</a></p></div><Status value="pending review" /></div>
                    <p className="review-detail"><b>Transfer reference:</b> {row.transfer_reference} · Submitted {new Date(row.submitted_at).toLocaleString()}</p>
                    <div className="review-actions">
                      <button className="button button-success" disabled={busyId === row.id} onClick={() => void reviewRemittance(row.id, true)}>{busyId === row.id ? 'Saving…' : 'Confirm received'}</button>
                      <button className="button button-danger" disabled={busyId === row.id} onClick={() => void reviewRemittance(row.id, false)}>Reject reference</button>
                    </div>
                  </article>
                ))}
                {finance.remittances.length === 0 ? <Empty>No cash remittances are awaiting review.</Empty> : null}
              </section>
              <section className="panel">
                <div className="section-heading"><div><h2>Seller and rider payouts</h2><p>Policy: sellers receive 100% of product sales; buyers pay delivery and service fees separately. Riders receive ₦1,500 per completed delivery.</p></div><Status value={`${filtered.payouts.length} due`} /></div>
                <p className="finance-warning">Payouts are blocked until the buyer confirms delivery. For cash orders, also confirm the rider’s remittance. Complete bank transfers outside GetBuy, then record the reference here.</p>
                {filtered.payouts.map((row) => {
                  const buyerAndPaymentConfirmed = row.remittance_status === 'confirmed' || row.remittance_status === 'payment_verified';
                  const canPay = buyerAndPaymentConfirmed && Boolean(row.bank_name && row.account_name && row.account_number);
                  return (
                    <article className="review-card payout-card" key={row.id}>
                      <div className="review-card-heading"><div><h3>{row.payout_type === 'seller' ? 'Store owner' : 'Delivery rider'} payout · {money(Number(row.amount))}</h3><p>Order #{row.order_id.slice(0, 8).toUpperCase()} · {row.beneficiary_name} · {row.beneficiary_email}</p></div><Status value={row.remittance_status === 'waiting_for_buyer' ? 'waiting for buyer confirmation' : row.remittance_status === 'payment_verified' ? 'payment verified' : row.remittance_status === 'confirmed' ? 'remittance confirmed' : 'waiting for remittance'} /></div>
                      {row.payout_type === 'seller' ? <p className="review-detail"><b>Store(s):</b> {row.store_names || 'Store not found'} · <b>Owner:</b> {row.beneficiary_name}</p> : null}
                      <p className="review-detail"><b>Bank:</b> {row.bank_name || 'Not provided'} · <b>Account:</b> {row.account_name || 'Not provided'} · <b>Number:</b> {row.account_number || 'Not provided'}</p>
                      {!row.bank_name || !row.account_name || !row.account_number ? <p className="missing-document">Recipient must save valid payout bank details before transfer.</p> : null}
                      <div className="payout-transfer-row">
                        <input aria-label="Bank transfer reference" value={transferReferences[row.id] || ''} onChange={(event) => setTransferReferences((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Bank transfer reference" />
                        <button className="button button-success" disabled={busyId === row.id || !canPay || !(transferReferences[row.id] || '').trim()} onClick={() => void payPayout(row.id)}>{busyId === row.id ? 'Saving…' : 'Record payout sent'}</button>
                      </div>
                    </article>
                  );
                })}
                {filtered.payouts.length === 0 ? <Empty>No due payouts match your search.</Empty> : null}
              </section>
            </>
          ) : null}
          <footer className="footer-note">GetBuy Admin · Secure marketplace operations</footer>
        </div>
      </main>
    </div>
  );
}

function Login({
  email = '',
  setEmail,
  password = '',
  setPassword,
  onSubmit,
  loading = false,
  error = '',
}: {
  email?: string;
  setEmail?: (value: string) => void;
  password?: string;
  setPassword?: (value: string) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  loading?: boolean;
  error?: string;
}) {
  const canSubmit = Boolean(onSubmit && setEmail && setPassword);
  return (
    <main className="login-screen">
      <section className="login-card">
        <a className="brand login-brand" href="#"><span className="brand-mark">G</span><span>getBuy<span className="brand-light"> admin</span></span></a>
        <p className="eyebrow">PRIVATE OPERATIONS PORTAL</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in with your GetBuy administrator account.</p>
        {error ? <div className="alert" role="alert">{error}</div> : null}
        {canSubmit ? (
          <form onSubmit={onSubmit}>
            <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail?.(event.target.value)} placeholder="admin@example.com" /></label>
            <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword?.(event.target.value)} placeholder="Your password" /></label>
            <button className="button button-primary login-submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in securely'}</button>
          </form>
        ) : null}
        <p className="login-footnote">Access is limited to accounts granted the administrator role.</p>
      </section>
    </main>
  );
}

function MetricCard({ label, value, icon, accent }: { label: string; value: number; icon: IconName; accent: string }) {
  return <article className="metric-card"><span className={`metric-icon ${accent}`}><Icon name={icon} /></span><span className="metric-label">{label}</span><b className="metric-value">{value.toLocaleString()}</b><span className="metric-caption">Marketplace total</span></article>;
}

function Document({ label, url }: { label: string; url: string }) {
  return <a className="document" href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} /><span>{label} <small>Open image <Icon name="external" /></small></span></a>;
}

function OrderTable({ rows }: { rows: Snapshot['orders'] }) {
  return <div className="table-wrap"><table><thead><tr><th>ORDER</th><th>BUYER</th><th>ITEMS</th><th>TOTAL</th><th>PAYMENT</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>#{row.id.slice(0, 8).toUpperCase()}</b></td><td>{row.buyer_name}</td><td>{row.item_count}</td><td><b>{money(Number(row.total))}</b></td><td>{row.payment_method.replaceAll('_', ' ')}</td><td><Status value={row.status} /></td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>)}</tbody></table>{rows.length === 0 ? <Empty>No orders to show.</Empty> : null}</div>;
}

function Empty({ children }: { children: string }) {
  return <div className="empty-panel">{children}</div>;
}
