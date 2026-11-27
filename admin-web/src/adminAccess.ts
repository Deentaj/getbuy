export const ADMIN_ROLES = ['super_admin', 'customer_service', 'account_manager', 'finance'] as const;
export const STAFF_ROLES = ['customer_service', 'account_manager', 'finance'] as const;

export type AdminRole = typeof ADMIN_ROLES[number];
export type StaffRole = typeof STAFF_ROLES[number];
export type AdminTab = 'overview' | 'orders' | 'stores' | 'products' | 'people' | 'support' | 'reports' | 'activity' | 'payouts' | 'staff';
export type AdminSectionIcon = 'overview' | 'orders' | 'stores' | 'products' | 'people' | 'support' | 'reports' | 'activity' | 'payouts';

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super administrator',
  customer_service: 'Customer service',
  account_manager: 'Account management',
  finance: 'Finance',
};

const tabDefinitions: Array<{
  id: AdminTab;
  label: string;
  icon: AdminSectionIcon;
  roles: readonly AdminRole[];
}> = [
  { id: 'overview', label: 'Overview', icon: 'overview', roles: ['super_admin'] },
  { id: 'orders', label: 'Orders', icon: 'orders', roles: ['super_admin'] },
  { id: 'stores', label: 'Stores', icon: 'stores', roles: ['super_admin', 'account_manager'] },
  { id: 'products', label: 'Products', icon: 'products', roles: ['super_admin', 'account_manager'] },
  { id: 'people', label: 'People & riders', icon: 'people', roles: ['super_admin', 'account_manager'] },
  { id: 'support', label: 'Support & refunds', icon: 'support', roles: ['super_admin', 'customer_service', 'finance'] },
  { id: 'reports', label: 'Revenue reports', icon: 'reports', roles: ['super_admin', 'finance'] },
  { id: 'activity', label: 'Activity log', icon: 'activity', roles: ['super_admin'] },
  { id: 'payouts', label: 'Payouts', icon: 'payouts', roles: ['super_admin', 'finance'] },
  { id: 'staff', label: 'Staff access', icon: 'people', roles: ['super_admin'] },
];

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.some((role) => role === value);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && STAFF_ROLES.some((role) => role === value);
}

export function getAdminTabs(role: AdminRole) {
  return tabDefinitions
    .filter((tab) => tab.roles.includes(role))
    .map((tab) => ({
      ...tab,
      label: tab.id === 'support'
        ? role === 'finance' ? 'Refunds' : role === 'customer_service' ? 'Customer support' : 'Support & refunds'
        : tab.label,
    }));
}
