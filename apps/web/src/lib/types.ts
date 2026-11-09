export type Role =
  | "SUPER_ADMIN"
  | "SOCIETY_ADMIN"
  | "PROPERTY_MANAGER"
  | "SECURITY_GUARD"
  | "RESIDENT";

export interface User {
  id: string;
  organization_id: string;
  property_id: string | null;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type InvitationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "COMPLETED";

export interface Invitation {
  id: string;
  property_id: string;
  resident_user_id: string;
  resident_name: string;
  visitor_name: string;
  visitor_phone: string | null;
  vehicle_registration: string | null;
  vehicle_category: string | null;
  visitor_type: string;
  purpose: string | null;
  expected_arrival: string;
  expected_departure: string;
  status: InvitationStatus;
  rejection_reason: string | null;
  approved_at: string | null;
  parking_slot_code: string | null;
  parking_zone: string | null;
  pass_expires_at: string | null;
  pass_status: string | null;
  created_at: string;
}

export interface ApproveResponse {
  invitation: Invitation;
  pass_token: string;
  pass_expires_at: string;
  pass_url: string;
  parking_slot_code: string | null;
}

export interface Availability {
  property_id: string;
  total_slots: number;
  available: number;
  reserved: number;
  occupied: number;
  blocked: number;
  maintenance: number;
  utilization_percent: number;
  by_category: Record<string, Record<string, number>>;
}

export interface VerifyResponse {
  allowed: boolean;
  reason_code: string;
  message: string;
  invitation_id: string | null;
  visitor_name: string | null;
  visitor_type: string | null;
  vehicle_registration: string | null;
  pass_expires_at: string | null;
  parking_slot_code: string | null;
  parking_zone: string | null;
  requires_confirmation: boolean;
}

export interface EntryAuthorization {
  entry_event_id: string;
  invitation_id: string;
  visitor_name: string;
  parking_slot_code: string | null;
  authorized_at: string;
  gate_opening_requested: boolean;
  next_step: string;
}

export interface ConfirmEntry {
  occupancy_id: string | null;
  slot_code: string | null;
  slot_status: string | null;
  entered_at: string | null;
  already_confirmed: boolean;
}

export interface ActiveVisitor {
  invitation_id: string;
  visitor_name: string;
  vehicle_registration: string | null;
  slot_code: string | null;
  zone_name: string | null;
  entered_at: string | null;
  expected_departure: string;
  overstay: boolean;
}

export interface GateEvent {
  id: string;
  direction: string;
  decision: string;
  reason: string | null;
  visitor_name: string | null;
  guard_name: string;
  created_at: string;
}

export interface PassView {
  visitor_name: string;
  visitor_type: string;
  property_name: string;
  property_address: string;
  expected_arrival: string;
  expected_departure: string;
  status: string;
  vehicle_registration: string | null;
  parking_slot_code: string | null;
  parking_zone: string | null;
  pass_expires_at: string | null;
  pass_status: string | null;
}

export interface Slot {
  id: string;
  property_id: string;
  zone_id: string;
  code: string;
  category: string;
  vehicle_category: string;
  status: "AVAILABLE" | "RESERVED" | "OCCUPIED" | "BLOCKED" | "MAINTENANCE";
  notes: string | null;
}

export interface Overview {
  property_id: string;
  total_slots: number;
  available_slots: number;
  reserved_slots: number;
  occupied_slots: number;
  blocked_slots: number;
  maintenance_slots: number;
  utilization_percent: number;
  visitors_inside: number;
  active_reservations: number;
  total_visitors_today: number;
  rejected_entries_today: number;
  manual_overrides_today: number;
  overstays: number;
}

export interface UtilizationRow {
  category: string;
  total: number;
  available: number;
  reserved: number;
  occupied: number;
  utilization_percent: number;
}

export interface TrendPoint {
  day: string;
  invitations: number;
  entries: number;
  exits: number;
}

export interface OverstayRow {
  occupancy_id: string;
  invitation_id: string;
  visitor_name: string;
  vehicle_registration: string | null;
  slot_code: string | null;
  entered_at: string;
  reserved_until: string;
  overdue_minutes: number;
}

export interface Reservation {
  id: string;
  slot_id: string;
  slot_code: string;
  invitation_id: string;
  visitor_name: string;
  status: string;
  reserved_from: string;
  reserved_until: string;
  released_at: string | null;
}

export interface Property {
  id: string;
  organization_id: string;
  name: string;
  address_line: string;
  city: string;
  state: string;
  timezone: string;
}

export interface JoinApartment {
  id: string;
  number: string;
  floor: number | null;
  tower_name: string | null;
}

export interface JoinProperty {
  property_id: string;
  name: string;
  address_line: string;
  city: string;
  state: string;
  apartments: JoinApartment[];
}

export interface JoinCode {
  property_id: string;
  join_code: string;
}

export interface ResidentAccount {
  user: User;
  apartment_id: string;
  is_verified: boolean;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  read_at: string | null;
  created_at: string;
}

export interface UnreadCount {
  count: number;
}

export interface Tower {
  id: string;
  property_id: string;
  name: string;
  floors: number | null;
}

export interface Apartment {
  id: string;
  property_id: string;
  tower_id: string | null;
  number: string;
  floor: number | null;
}

export interface Zone {
  id: string;
  property_id: string;
  name: string;
  level: string | null;
  category: string;
  priority: number;
  is_active: boolean;
}

export interface OfflineGateActionResult {
  client_event_id: string;
  action: string;
  status: "applied" | "already_applied" | "duplicate" | "rejected";
  code?: string | null;
  message?: string | null;
  result: Record<string, unknown>;
}

export interface OfflineReconcileResponse {
  device_id: string;
  received: number;
  applied: number;
  duplicates: number;
  rejected: number;
  results: OfflineGateActionResult[];
}

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Policy {
  id: string;
  property_id: string;
  qr_validity_minutes: number;
  overstay_grace_minutes: number;
  max_active_visitors: number;
  allow_manual_override: boolean;
  require_vehicle_for_entry: boolean;
  visitor_window_start: string;
  visitor_window_end: string;
}
