import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Car,
  Check,
  Copy,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Settings2,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  SectionTitle,
  Select,
  Spinner,
  statusTone,
} from "../components/ui";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";
import type {
  Apartment,
  JoinCode,
  Page,
  Policy,
  Property,
  ResidentAccount,
  Slot,
  Tower,
  Zone,
} from "../lib/types";

const ZONE_CATEGORIES = [
  "VISITOR",
  "RESIDENT",
  "RESERVED",
  "TEMPORARY",
  "SERVICE",
  "EMERGENCY",
  "ACCESSIBLE",
];

export function InventoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = ["SUPER_ADMIN", "SOCIETY_ADMIN", "PROPERTY_MANAGER"].includes(user?.role ?? "");
  const [copied, setCopied] = useState(false);
  const properties = useQuery({
    queryKey: ["properties"],
    queryFn: () => api<Property[]>("/properties"),
  });

  const [activeProperty, setActiveProperty] = useState<string>("");
  useEffect(() => {
    if (activeProperty) return;
    const candidate = user?.property_id ?? properties.data?.[0]?.id;
    if (candidate) setActiveProperty(candidate);
  }, [activeProperty, properties.data, user?.property_id]);

  const propertyId = activeProperty;

  const towers = useQuery({
    queryKey: ["towers", propertyId],
    queryFn: () => api<Tower[]>(`/properties/${propertyId}/towers`),
    enabled: Boolean(propertyId),
  });
  const apartments = useQuery({
    queryKey: ["apartments", propertyId],
    queryFn: () =>
      api<Page<Apartment>>(`/properties/${propertyId}/apartments?limit=100`),
    enabled: Boolean(propertyId),
  });
  const zones = useQuery({
    queryKey: ["zones", propertyId],
    queryFn: () => api<Zone[]>(`/parking/zones?property_id=${propertyId}`),
    enabled: Boolean(propertyId),
  });
  const slots = useQuery({
    queryKey: ["slots", propertyId],
    queryFn: () =>
      api<Page<Slot>>(`/parking/slots?property_id=${propertyId}&limit=200`),
    enabled: Boolean(propertyId),
  });
  const policy = useQuery({
    queryKey: ["policy", propertyId],
    queryFn: () => api<Policy>(`/properties/${propertyId}/policy`),
    enabled: Boolean(propertyId),
  });
  const joinCode = useQuery({
    queryKey: ["join-code", propertyId],
    queryFn: () => api<JoinCode>(`/properties/${propertyId}/join-code`),
    enabled: Boolean(propertyId) && canManage,
  });
  const residents = useQuery({
    queryKey: ["residents", propertyId],
    queryFn: () =>
      api<Page<ResidentAccount>>(`/properties/${propertyId}/residents?limit=100`),
    enabled: Boolean(propertyId) && canManage,
  });

  const invalidate = (key: string) =>
    void queryClient.invalidateQueries({ queryKey: [key] });

  const createProperty = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Property>("/properties", { method: "POST", json: body }),
    onSuccess: () => invalidate("properties"),
  });
  const createTower = useMutation({
    mutationFn: (body: { name: string; floors: number | null }) =>
      api<Tower>(`/properties/${propertyId}/towers`, { method: "POST", json: body }),
    onSuccess: () => {
      invalidate("towers");
      invalidate("properties");
    },
  });
  const createApartment = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Apartment>("/apartments", { method: "POST", json: body }),
    onSuccess: () => invalidate("apartments"),
  });
  const createZone = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Zone>("/parking/zones", { method: "POST", json: body }),
    onSuccess: () => invalidate("zones"),
  });
  const createSlot = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Slot>("/parking/slots", { method: "POST", json: body }),
    onSuccess: () => invalidate("slots"),
  });
  const updateSlot = useMutation({
    mutationFn: ({ slotId, status }: { slotId: string; status: string }) =>
      api<Slot>(`/parking/slots/${slotId}`, { method: "PATCH", json: { status } }),
    onSuccess: () => invalidate("slots"),
  });
  const updatePolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Policy>(`/properties/${propertyId}/policy`, { method: "PATCH", json: body }),
    onSuccess: () => invalidate("policy"),
  });
  const rotateJoinCode = useMutation({
    mutationFn: () =>
      api<JoinCode>(`/properties/${propertyId}/join-code/rotate`, { method: "POST" }),
    onSuccess: () => invalidate("join-code"),
  });
  const updateResident = useMutation({
    mutationFn: ({ userId, isVerified }: { userId: string; isVerified: boolean }) =>
      api<ResidentAccount>(`/residents/${userId}`, {
        method: "PATCH",
        json: { is_verified: isVerified },
      }),
    onSuccess: () => invalidate("residents"),
  });

  const canCreateProperty =
    user?.role === "SUPER_ADMIN" || user?.role === "SOCIETY_ADMIN";

  const [propertyForm, setPropertyForm] = useState({
    name: "",
    address_line: "",
    city: "",
    state: "",
    pincode: "",
  });
  const [towerForm, setTowerForm] = useState({ name: "", floors: "" });
  const [apartmentForm, setApartmentForm] = useState({
    number: "",
    floor: "",
    tower_id: "",
  });
  const [zoneForm, setZoneForm] = useState({
    name: "",
    level: "Ground",
    category: "VISITOR",
    priority: "10",
  });
  const [slotForm, setSlotForm] = useState({ code: "", zone_id: "", vehicle_category: "FOUR_WHEELER" });

  const error =
    createProperty.error ??
    createTower.error ??
    createApartment.error ??
    createZone.error ??
    createSlot.error ??
    updateSlot.error ??
    updatePolicy.error ??
    rotateJoinCode.error ??
    updateResident.error;

  if (!propertyId) {
    return (
      <Card className="p-8">
        <SectionTitle
          title="No property context"
          caption="Create a society property first, or ask the platform owner to provision one."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-8" data-testid="inventory-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.24em] text-teal-bright uppercase">
            Society inventory
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Properties & parking</h1>
          <p className="mt-1 text-sm text-slate-400">
            Physical structure, bays and the visitor policy the allocation engine enforces.
          </p>
        </div>
        {properties.data && properties.data.length > 1 ? (
          <div className="w-64">
            <Field label="Active property">
              <Select
                value={propertyId}
                onChange={(event) => setActiveProperty(event.target.value)}
              >
                {properties.data.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <Badge tone="teal">
            <Building2 className="h-3 w-3" />
            {properties.data?.[0]?.name ?? "Property"}
          </Badge>
        )}
      </div>

      {error ? <ErrorNote message={(error as Error).message} /> : null}

      {canManage ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-teal-bright uppercase">
              Resident onboarding
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
              <KeyRound className="h-4 w-4 text-teal/70" /> Society join code
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              Share this code only with residents. It lets them select an apartment and create an
              account at <span className="font-mono text-xs text-slate-300">/register</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-xl border border-teal/30 bg-teal/5 px-4 py-2.5 font-mono text-sm tracking-[0.12em] text-teal-bright">
              {joinCode.data?.join_code ?? "Loading…"}
            </code>
            <Button
              type="button"
              variant="secondary"
              disabled={!joinCode.data}
              onClick={() => {
                if (!joinCode.data) return;
                void navigator.clipboard.writeText(joinCode.data.join_code);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={rotateJoinCode.isPending}
              onClick={() => rotateJoinCode.mutate()}
            >
              <RefreshCw className="h-4 w-4" /> Rotate
            </Button>
          </div>
        </Card>
      ) : null}

      {canManage ? (
        <Card className="p-6">
          <SectionTitle
            title="Resident accounts"
            caption="Verify a self-registered resident before they can issue visitor invitations"
            action={<UserCheck className="h-4 w-4 text-teal/70" />}
          />
          {residents.isLoading ? <Spinner label="Loading residents" /> : null}
          <div className="mt-4 divide-y divide-white/[0.06]">
            {residents.data?.items.map((resident) => {
              const apartment = apartments.data?.items.find(
                (item) => item.id === resident.apartment_id,
              );
              return (
                <div
                  key={resident.user.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100">{resident.user.full_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {resident.user.email} · {apartment ? apartment.number : "Apartment unavailable"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={resident.is_verified ? "teal" : "amber"}>
                      {resident.is_verified ? "Verified" : "Pending"}
                    </Badge>
                    <Button
                      type="button"
                      variant={resident.is_verified ? "ghost" : "secondary"}
                      className="px-3 py-1.5 text-xs"
                      disabled={updateResident.isPending}
                      onClick={() =>
                        updateResident.mutate({
                          userId: resident.user.id,
                          isVerified: !resident.is_verified,
                        })
                      }
                    >
                      {resident.is_verified ? "Suspend" : "Verify"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {!residents.isLoading && residents.data?.items.length === 0 ? (
            <EmptyState
              title="No resident accounts yet"
              body="Share the join code above so residents can register."
            />
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <SectionTitle
            title="Towers"
            caption={`${towers.data?.length ?? 0} blocks registered`}
            action={<Layers className="h-4 w-4 text-teal/70" />}
          />
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_100px_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              createTower.mutate({
                name: towerForm.name,
                floors: towerForm.floors ? Number(towerForm.floors) : null,
              });
              setTowerForm({ name: "", floors: "" });
            }}
          >
            <Field label="Tower name">
              <Input
                required
                value={towerForm.name}
                onChange={(event) => setTowerForm({ ...towerForm, name: event.target.value })}
                placeholder="Tower C"
              />
            </Field>
            <Field label="Floors">
              <Input
                type="number"
                min={1}
                value={towerForm.floors}
                onChange={(event) => setTowerForm({ ...towerForm, floors: event.target.value })}
                placeholder="12"
              />
            </Field>
            <Button type="submit" disabled={createTower.isPending}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {towers.isLoading ? <Spinner /> : null}
            {towers.data?.map((tower) => (
              <Badge key={tower.id} tone="slate">
                {tower.name}
                {tower.floors ? ` · ${tower.floors}F` : ""}
              </Badge>
            ))}
            {!towers.isLoading && towers.data?.length === 0 ? (
              <EmptyState title="No towers yet" />
            ) : null}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle
            title="Apartments"
            caption={`${apartments.data?.total ?? 0} units registered`}
          />
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createApartment.mutate({
                property_id: propertyId,
                tower_id: apartmentForm.tower_id || null,
                number: apartmentForm.number,
                floor: apartmentForm.floor ? Number(apartmentForm.floor) : null,
              });
              setApartmentForm({ number: "", floor: "", tower_id: apartmentForm.tower_id });
            }}
          >
            <Field label="Unit number">
              <Input
                required
                value={apartmentForm.number}
                onChange={(event) =>
                  setApartmentForm({ ...apartmentForm, number: event.target.value })
                }
                placeholder="A-101"
              />
            </Field>
            <Field label="Floor">
              <Input
                type="number"
                value={apartmentForm.floor}
                onChange={(event) =>
                  setApartmentForm({ ...apartmentForm, floor: event.target.value })
                }
                placeholder="1"
              />
            </Field>
            <Field label="Tower">
              <Select
                value={apartmentForm.tower_id}
                onChange={(event) =>
                  setApartmentForm({ ...apartmentForm, tower_id: event.target.value })
                }
              >
                <option value="">Unassigned</option>
                {towers.data?.map((tower) => (
                  <option key={tower.id} value={tower.id}>
                    {tower.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={createApartment.isPending}>
                <Plus className="h-4 w-4" /> Add apartment
              </Button>
            </div>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {apartments.data?.items.slice(0, 12).map((apartment) => (
              <Badge key={apartment.id} tone="slate">
                {apartment.number}
              </Badge>
            ))}
            {(apartments.data?.total ?? 0) > 12 ? (
              <span className="text-xs text-slate-500">
                +{(apartments.data?.total ?? 0) - 12} more
              </span>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <SectionTitle
            title="Parking zones"
            caption="Priority decides which zone the allocator fills first"
          />
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createZone.mutate({
                property_id: propertyId,
                name: zoneForm.name,
                level: zoneForm.level || null,
                category: zoneForm.category,
                priority: Number(zoneForm.priority) || 100,
              });
              setZoneForm({ ...zoneForm, name: "" });
            }}
          >
            <Field label="Zone name">
              <Input
                required
                value={zoneForm.name}
                onChange={(event) => setZoneForm({ ...zoneForm, name: event.target.value })}
                placeholder="Visitor Bay South"
              />
            </Field>
            <Field label="Level">
              <Input
                value={zoneForm.level}
                onChange={(event) => setZoneForm({ ...zoneForm, level: event.target.value })}
                placeholder="Basement 1"
              />
            </Field>
            <Field label="Category">
              <Select
                value={zoneForm.category}
                onChange={(event) => setZoneForm({ ...zoneForm, category: event.target.value })}
              >
                {ZONE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {titleCase(category)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" hint="lower fills first">
              <Input
                type="number"
                min={1}
                max={1000}
                value={zoneForm.priority}
                onChange={(event) => setZoneForm({ ...zoneForm, priority: event.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createZone.isPending}>
                <Plus className="h-4 w-4" /> Create zone
              </Button>
            </div>
          </form>

          <div className="mt-5 space-y-2">
            {zones.data?.map((zone) => (
              <div
                key={zone.id}
                className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-2.5"
              >
                <span className="text-sm text-slate-200">
                  {zone.name} <span className="text-slate-500">· {titleCase(zone.category)}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500">P{zone.priority}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle
            title="Parking slots"
            caption={`${slots.data?.total ?? 0} bays in this property`}
            action={<Car className="h-4 w-4 text-teal/70" />}
          />
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createSlot.mutate({
                property_id: propertyId,
                zone_id: slotForm.zone_id || zones.data?.[0]?.id,
                code: slotForm.code,
                vehicle_category: slotForm.vehicle_category,
              });
              setSlotForm({ ...slotForm, code: "" });
            }}
          >
            <Field label="Slot code">
              <Input
                required
                value={slotForm.code}
                onChange={(event) => setSlotForm({ ...slotForm, code: event.target.value })}
                placeholder="V-11"
              />
            </Field>
            <Field label="Zone">
              <Select
                required
                value={slotForm.zone_id}
                onChange={(event) => setSlotForm({ ...slotForm, zone_id: event.target.value })}
              >
                <option value="">Select a zone</option>
                {zones.data?.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vehicle class">
              <Select
                value={slotForm.vehicle_category}
                onChange={(event) =>
                  setSlotForm({ ...slotForm, vehicle_category: event.target.value })
                }
              >
                <option value="ANY">Any vehicle</option>
                <option value="FOUR_WHEELER">Four wheeler</option>
                <option value="TWO_WHEELER">Two wheeler</option>
                <option value="EV">EV</option>
                <option value="OVERSIZED">Oversized</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={createSlot.isPending}>
                <Plus className="h-4 w-4" /> Add slot
              </Button>
            </div>
          </form>

          <div className="mt-5 max-h-72 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slots.data?.items.map((slot) => (
                <div
                  key={slot.id}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-white">{slot.code}</span>
                    <Badge tone={statusTone(slot.status)}>{slot.status}</Badge>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">{titleCase(slot.category)}</p>
                  {slot.status === "AVAILABLE" || slot.status === "BLOCKED" || slot.status === "MAINTENANCE" ? (
                    <div className="mt-2 flex gap-1">
                      {slot.status !== "BLOCKED" ? (
                        <button
                          className="rounded border border-red-400/30 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-500/10"
                          onClick={() => updateSlot.mutate({ slotId: slot.id, status: "BLOCKED" })}
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          className="rounded border border-teal/40 px-1.5 py-0.5 text-[10px] text-teal-bright hover:bg-teal/10"
                          onClick={() => updateSlot.mutate({ slotId: slot.id, status: "AVAILABLE" })}
                        >
                          <Check className="mr-0.5 inline h-2.5 w-2.5" />
                          Free
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {slots.data?.items.length === 0 ? <EmptyState title="No slots yet" /> : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {canCreateProperty ? (
          <Card className="p-6">
            <SectionTitle
              title="New property"
              caption="A property is the tenant boundary for parking and residents"
            />
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                createProperty.mutate(propertyForm);
                setPropertyForm({ name: "", address_line: "", city: "", state: "", pincode: "" });
              }}
            >
              <Field label="Property name">
                <Input
                  required
                  value={propertyForm.name}
                  onChange={(event) =>
                    setPropertyForm({ ...propertyForm, name: event.target.value })
                  }
                  placeholder="Skyline Residency"
                />
              </Field>
              <Field label="Address">
                <Input
                  value={propertyForm.address_line}
                  onChange={(event) =>
                    setPropertyForm({ ...propertyForm, address_line: event.target.value })
                  }
                  placeholder="12 Orchid Avenue"
                />
              </Field>
              <Field label="City">
                <Input
                  value={propertyForm.city}
                  onChange={(event) =>
                    setPropertyForm({ ...propertyForm, city: event.target.value })
                  }
                  placeholder="Bengaluru"
                />
              </Field>
              <Field label="State">
                <Input
                  value={propertyForm.state}
                  onChange={(event) =>
                    setPropertyForm({ ...propertyForm, state: event.target.value })
                  }
                  placeholder="Karnataka"
                />
              </Field>
              <Field label="Pincode">
                <Input
                  value={propertyForm.pincode}
                  onChange={(event) =>
                    setPropertyForm({ ...propertyForm, pincode: event.target.value })
                  }
                  placeholder="560066"
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={createProperty.isPending}>
                  <Building2 className="h-4 w-4" /> Register property
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card className="p-6">
          <SectionTitle
            title="Visitor policy"
            caption="Enforced by gate verification and allocation"
            action={<Settings2 className="h-4 w-4 text-teal/70" />}
          />
          {policy.data ? (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                updatePolicy.mutate({
                  qr_validity_minutes: Number(form.get("qr_validity_minutes")),
                  overstay_grace_minutes: Number(form.get("overstay_grace_minutes")),
                  max_active_visitors: Number(form.get("max_active_visitors")),
                  visitor_window_start: String(form.get("visitor_window_start")),
                  visitor_window_end: String(form.get("visitor_window_end")),
                  allow_manual_override: form.get("allow_manual_override") === "on",
                  require_vehicle_for_entry: form.get("require_vehicle_for_entry") === "on",
                });
              }}
            >
              <Field label="QR validity" hint="minutes">
                <Input
                  name="qr_validity_minutes"
                  type="number"
                  min={5}
                  max={1440}
                  defaultValue={policy.data.qr_validity_minutes}
                />
              </Field>
              <Field label="Overstay grace" hint="minutes">
                <Input
                  name="overstay_grace_minutes"
                  type="number"
                  min={0}
                  max={720}
                  defaultValue={policy.data.overstay_grace_minutes}
                />
              </Field>
              <Field label="Active visitor limit">
                <Input
                  name="max_active_visitors"
                  type="number"
                  min={0}
                  max={5000}
                  defaultValue={policy.data.max_active_visitors}
                />
              </Field>
              <Field label="Visitor window">
                <div className="flex items-center gap-2">
                  <Input
                    name="visitor_window_start"
                    type="time"
                    defaultValue={policy.data.visitor_window_start.slice(0, 5)}
                  />
                  <span className="text-xs text-slate-500">to</span>
                  <Input
                    name="visitor_window_end"
                    type="time"
                    defaultValue={policy.data.visitor_window_end.slice(0, 5)}
                  />
                </div>
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  name="allow_manual_override"
                  defaultChecked={policy.data.allow_manual_override}
                  className="h-4 w-4 accent-teal"
                />
                Allow audited manual override
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  name="require_vehicle_for_entry"
                  defaultChecked={policy.data.require_vehicle_for_entry}
                  className="h-4 w-4 accent-teal"
                />
                Require a vehicle at entry
              </label>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" disabled={updatePolicy.isPending}>
                  <Check className="h-4 w-4" />
                  {updatePolicy.isPending ? "Saving…" : "Save policy"}
                </Button>
                {updatePolicy.isSuccess ? (
                  <span className="text-xs text-teal-bright">Policy updated</span>
                ) : null}
              </div>
            </form>
          ) : (
            <Spinner label="Loading policy" />
          )}
        </Card>
      </div>
    </div>
  );
}
