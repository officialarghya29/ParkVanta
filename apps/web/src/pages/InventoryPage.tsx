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
  PageHeader,
  SectionTitle,
  Select,
  Spinner,
  SuccessNote,
  statusTone,
} from "../components/ui";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
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

type InventoryTab = "onboarding" | "structure" | "parking" | "policy";

export function InventoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = ["SUPER_ADMIN", "SOCIETY_ADMIN", "PROPERTY_MANAGER"].includes(user?.role ?? "");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<InventoryTab>("onboarding");
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

  const tabs: { id: InventoryTab; label: string; count?: number }[] = [
    ...(canManage
      ? [{ id: "onboarding" as const, label: "Onboarding & Residents", count: residents.data?.total }]
      : []),
    { id: "structure", label: "Towers & Units", count: apartments.data?.total },
    { id: "parking", label: "Parking Zones & Bays", count: slots.data?.total },
    { id: "policy", label: "Policy & Properties" },
  ];

  const activeTab = !canManage && tab === "onboarding" ? "structure" : tab;

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <PageHeader
        eyebrow="Property administration"
        title="Inventory & onboarding"
        description="Manage resident verification, join codes, towers, apartments, parking bays, and gate policy."
        actions={
          properties.data && properties.data.length > 1 ? (
            <div className="w-64">
              <Select
                aria-label="Active property"
                value={propertyId}
                onChange={(event) => setActiveProperty(event.target.value)}
              >
                {properties.data.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <Badge tone="teal">
              <Building2 className="h-3 w-3" />
              {properties.data?.[0]?.name ?? "Property"}
            </Badge>
          )
        }
      />

      {error ? <ErrorNote message={(error as Error).message} /> : null}

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Inventory sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
              activeTab === item.id
                ? "border-accent text-accent"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            <span>{item.label}</span>
            {item.count !== undefined ? (
              <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-subtle">
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === "onboarding" && canManage ? (
        <div className="space-y-6">
          <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">
                Self-registration access
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-base font-semibold text-ink">
                <KeyRound className="h-4 w-4 text-accent" /> Society join code
              </h2>
              <p className="mt-1 max-w-xl text-sm text-ink-muted">
                Share this code only with verified residents so they can register at{" "}
                <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-xs text-ink">
                  /register
                </code>
                .
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-lg border border-accent-border bg-accent-soft px-3.5 py-2 font-mono text-sm font-semibold tracking-widest text-accent">
                {joinCode.data?.join_code ?? "Loading…"}
              </code>
              <Button
                variant="secondary"
                size="sm"
                disabled={!joinCode.data}
                onClick={() => {
                  if (!joinCode.data) return;
                  void navigator.clipboard.writeText(joinCode.data.join_code);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={rotateJoinCode.isPending}
                onClick={() => rotateJoinCode.mutate()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Rotate
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <SectionTitle
                title="Resident accounts"
                caption="Verify self-registered residents before they can create visitor passes"
              />
              <UserCheck className="h-4 w-4 text-accent" />
            </div>

            {residents.isLoading ? (
              <div className="px-6">
                <Spinner label="Loading residents" />
              </div>
            ) : null}

            {residents.data?.items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle/70 text-[11px] font-semibold tracking-wider text-ink-subtle uppercase">
                      <th className="px-6 py-3">Resident</th>
                      <th className="py-3 pr-4">Email</th>
                      <th className="py-3 pr-4">Apartment</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {residents.data.items.map((resident) => {
                      const apartment = apartments.data?.items.find(
                        (item) => item.id === resident.apartment_id,
                      );
                      return (
                        <tr key={resident.user.id} className="hover:bg-surface-subtle/40">
                          <td className="px-6 py-3 font-medium text-ink">{resident.user.full_name}</td>
                          <td className="py-3 pr-4 text-ink-muted">{resident.user.email}</td>
                          <td className="py-3 pr-4 font-mono text-xs text-ink">
                            {apartment ? apartment.number : "Unavailable"}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge tone={resident.is_verified ? "teal" : "amber"} dot>
                              {resident.is_verified ? "Verified" : "Pending"}
                            </Badge>
                          </td>
                          <td className="py-3 pr-6 text-right">
                            <Button
                              variant={resident.is_verified ? "ghost" : "secondary"}
                              size="sm"
                              disabled={updateResident.isPending}
                              onClick={() =>
                                updateResident.mutate({
                                  userId: resident.user.id,
                                  isVerified: !resident.is_verified,
                                })
                              }
                            >
                              {resident.is_verified ? "Unverify" : "Verify"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!residents.isLoading && residents.data?.items.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No resident accounts yet"
                  body="Share the join code above so residents can register."
                />
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {activeTab === "structure" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="p-6">
            <SectionTitle
              title="Towers & blocks"
              caption={`${towers.data?.length ?? 0} blocks registered`}
              action={<Layers className="h-4 w-4 text-ink-subtle" />}
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
              <Field label="Tower name" required>
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
              <Field label="Unit number" required>
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
              {apartments.data?.items.slice(0, 18).map((apartment) => (
                <Badge key={apartment.id} tone="slate">
                  {apartment.number}
                </Badge>
              ))}
              {(apartments.data?.total ?? 0) > 18 ? (
                <span className="self-center text-xs text-ink-subtle">
                  +{(apartments.data?.total ?? 0) - 18} more
                </span>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === "parking" ? (
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
              <Field label="Zone name" required>
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
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-subtle/50 px-3.5 py-2.5"
                >
                  <span className="text-sm font-medium text-ink">
                    {zone.name}{" "}
                    <span className="font-normal text-ink-muted">· {titleCase(zone.category)}</span>
                  </span>
                  <span className="font-mono text-xs text-ink-subtle">P{zone.priority}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionTitle
              title="Parking slots"
              caption={`${slots.data?.total ?? 0} bays in this property`}
              action={<Car className="h-4 w-4 text-ink-subtle" />}
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
              <Field label="Slot code" required>
                <Input
                  required
                  value={slotForm.code}
                  onChange={(event) => setSlotForm({ ...slotForm, code: event.target.value })}
                  placeholder="V-11"
                />
              </Field>
              <Field label="Zone" required>
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

            <div className="mt-5 max-h-80 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {slots.data?.items.map((slot) => (
                  <div
                    key={slot.id}
                    className="rounded-lg border border-border bg-surface-subtle/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-ink">{slot.code}</span>
                      <Badge tone={statusTone(slot.status)}>{slot.status}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-subtle">{titleCase(slot.category)}</p>
                    {slot.status === "AVAILABLE" || slot.status === "BLOCKED" || slot.status === "MAINTENANCE" ? (
                      <div className="mt-2">
                        {slot.status !== "BLOCKED" ? (
                          <button
                            type="button"
                            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100"
                            onClick={() => updateSlot.mutate({ slotId: slot.id, status: "BLOCKED" })}
                          >
                            Block bay
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                            onClick={() => updateSlot.mutate({ slotId: slot.id, status: "AVAILABLE" })}
                          >
                            <Check className="mr-0.5 inline h-3 w-3" />
                            Release
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
      ) : null}

      {activeTab === "policy" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {canCreateProperty ? (
            <Card className="p-6">
              <SectionTitle
                title="Register property"
                caption="Each property forms a tenant boundary for parking and residents"
              />
              <form
                className="mt-4 grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  createProperty.mutate(propertyForm);
                  setPropertyForm({ name: "", address_line: "", city: "", state: "", pincode: "" });
                }}
              >
                <Field label="Property name" required>
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
              caption="Enforced server-side during gate verification and bay allocation"
              action={<Settings2 className="h-4 w-4 text-ink-subtle" />}
            />
            {policy.data ? (
              <form
                className="mt-4 grid gap-4 sm:grid-cols-2"
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
                    <span className="text-xs text-ink-subtle">to</span>
                    <Input
                      name="visitor_window_end"
                      type="time"
                      defaultValue={policy.data.visitor_window_end.slice(0, 5)}
                    />
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="allow_manual_override"
                    defaultChecked={policy.data.allow_manual_override}
                    className="h-4 w-4 rounded border-border-strong accent-accent"
                  />
                  Allow audited manual override
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="require_vehicle_for_entry"
                    defaultChecked={policy.data.require_vehicle_for_entry}
                    className="h-4 w-4 rounded border-border-strong accent-accent"
                  />
                  Require a vehicle at entry
                </label>
                <div className="sm:col-span-2 space-y-3">
                  <Button type="submit" disabled={updatePolicy.isPending}>
                    <Check className="h-4 w-4" />
                    {updatePolicy.isPending ? "Saving…" : "Save policy"}
                  </Button>
                  {updatePolicy.isSuccess ? <SuccessNote message="Policy updated" /> : null}
                </div>
              </form>
            ) : (
              <Spinner label="Loading policy" />
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
