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
  Search,
  Settings2,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  SegmentedTabs,
  Select,
  Spinner,
  StudioPane,
  StudioPaneHeader,
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
  const [tab, setTab] = useState<InventoryTab>(canManage ? "onboarding" : "structure");
  const [residentSearch, setResidentSearch] = useState("");
  const [slotFilter, setSlotFilter] = useState("ALL");

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
    queryFn: () => api<Page<Apartment>>(`/properties/${propertyId}/apartments?limit=100`),
    enabled: Boolean(propertyId),
  });
  const zones = useQuery({
    queryKey: ["zones", propertyId],
    queryFn: () => api<Zone[]>(`/parking/zones?property_id=${propertyId}`),
    enabled: Boolean(propertyId),
  });
  const slots = useQuery({
    queryKey: ["slots", propertyId],
    queryFn: () => api<Page<Slot>>(`/parking/slots?property_id=${propertyId}&limit=200`),
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
    queryFn: () => api<Page<ResidentAccount>>(`/properties/${propertyId}/residents?limit=100`),
    enabled: Boolean(propertyId) && canManage,
  });

  const invalidate = (key: string) => void queryClient.invalidateQueries({ queryKey: [key] });

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
  const [slotForm, setSlotForm] = useState({
    code: "",
    zone_id: "",
    vehicle_category: "FOUR_WHEELER",
  });

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
      <StudioPane className="p-8">
        <EmptyState
          title="No property context"
          body="Create a society property first, or ask the platform owner to provision one."
        />
      </StudioPane>
    );
  }

  const activeTab: InventoryTab = !canManage && tab === "onboarding" ? "structure" : tab;

  const navSections = [
    ...(canManage
      ? [
          {
            id: "onboarding" as const,
            label: "Onboarding & Residents",
            icon: UserCheck,
            count: residents.data?.total,
          },
        ]
      : []),
    {
      id: "structure" as const,
      label: "Towers & Units",
      icon: Layers,
      count: apartments.data?.total,
    },
    {
      id: "parking" as const,
      label: "Parking Zones & Bays",
      icon: Car,
      count: slots.data?.total,
    },
    {
      id: "policy" as const,
      label: "Policy & Properties",
      icon: Settings2,
    },
  ];

  const residentRows = (residents.data?.items ?? []).filter((r) => {
    const q = residentSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      r.user.full_name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q)
    );
  });

  const slotRows = (slots.data?.items ?? []).filter((s) =>
    slotFilter === "ALL" ? true : s.status === slotFilter,
  );

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <PageHeader
        eyebrow="Property Configuration"
        title="Society inventory & policies"
        description="Manage resident verification, building towers, parking zones, bay allocations, and gate rules."
        action={
          properties.data && properties.data.length > 1 ? (
            <div className="w-60">
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
            <Badge tone="accent" dot>
              <Building2 className="h-3 w-3" />
              {properties.data?.[0]?.name ?? "Property"}
            </Badge>
          )
        }
      />

      {error ? <ErrorNote message={(error as Error).message} /> : null}

      {/* Studio Settings Split Layout */}
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Left Settings Section Rail */}
        <StudioPane className="h-fit p-2">
          <nav aria-label="Inventory sections" className="space-y-1">
            {navSections.map((item) => {
              const Icon = item.icon;
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors",
                    selected
                      ? "bg-accent-soft text-accent"
                      : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
                  )}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.count !== undefined ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular",
                        selected
                          ? "bg-surface text-accent"
                          : "bg-surface-subtle text-ink-subtle",
                      )}
                    >
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </StudioPane>

        {/* Right Active Configuration Workspace */}
        <div className="min-w-0 space-y-6">
          {activeTab === "onboarding" && canManage ? (
            <>
              <StudioPane>
                <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                      Self-registration access
                    </p>
                    <h2 className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
                      <KeyRound className="h-4 w-4 text-accent" />
                      Society join code
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Share only with verified residents registering at{" "}
                      <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        /register
                      </code>
                      .
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-lg border border-accent-border bg-accent-soft px-3.5 py-1.5 font-mono text-sm font-semibold tracking-widest text-accent">
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
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={rotateJoinCode.isPending}
                      onClick={() => rotateJoinCode.mutate()}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rotate
                    </Button>
                  </div>
                </div>
              </StudioPane>

              <StudioPane>
                <StudioPaneHeader
                  title="Resident accounts"
                  subtitle="Verify self-registered residents before they can issue visitor passes"
                  action={
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                      <Input
                        value={residentSearch}
                        onChange={(e) => setResidentSearch(e.target.value)}
                        placeholder="Search resident or email"
                        aria-label="Search resident or email"
                        className="h-8 w-52 pl-8 text-xs"
                      />
                    </div>
                  }
                />

                {residents.isLoading ? (
                  <div className="p-6">
                    <Spinner label="Loading residents…" />
                  </div>
                ) : !residentRows.length ? (
                  <div className="p-6">
                    <EmptyState
                      title="No matching resident accounts"
                      body="Share the society join code above so residents can self-register."
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                          <th className="px-5 py-2.5">Resident</th>
                          <th className="py-2.5 pr-4">Email</th>
                          <th className="py-2.5 pr-4">Apartment</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 pr-5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {residentRows.map((resident) => {
                          const apartment = apartments.data?.items.find(
                            (item) => item.id === resident.apartment_id,
                          );
                          return (
                            <tr key={resident.user.id} className="hover:bg-surface-subtle/60">
                              <td className="px-5 py-3 font-medium text-ink">
                                {resident.user.full_name}
                              </td>
                              <td className="py-3 pr-4 text-xs text-ink-muted">
                                {resident.user.email}
                              </td>
                              <td className="py-3 pr-4 font-mono text-xs text-ink">
                                {apartment ? apartment.number : "Unavailable"}
                              </td>
                              <td className="py-3 pr-4">
                                <Badge tone={resident.is_verified ? "ok" : "warn"} dot>
                                  {resident.is_verified ? "Verified" : "Pending"}
                                </Badge>
                              </td>
                              <td className="py-3 pr-5 text-right">
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
                )}
              </StudioPane>
            </>
          ) : null}

          {activeTab === "structure" ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <StudioPane className="h-fit">
                <StudioPaneHeader
                  title="Towers & blocks"
                  subtitle={`${towers.data?.length ?? 0} blocks registered`}
                />
                <form
                  className="grid gap-3 border-b border-line bg-surface-subtle/50 p-5 sm:grid-cols-[1fr_110px_auto]"
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
                      onChange={(event) =>
                        setTowerForm({ ...towerForm, name: event.target.value })
                      }
                      placeholder="Tower C"
                    />
                  </Field>
                  <Field label="Floors">
                    <Input
                      type="number"
                      min={1}
                      value={towerForm.floors}
                      onChange={(event) =>
                        setTowerForm({ ...towerForm, floors: event.target.value })
                      }
                      placeholder="12"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit" disabled={createTower.isPending}>
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </form>

                <div className="divide-y divide-line">
                  {towers.isLoading ? (
                    <div className="p-5">
                      <Spinner />
                    </div>
                  ) : !towers.data?.length ? (
                    <div className="p-5">
                      <EmptyState title="No towers yet" />
                    </div>
                  ) : (
                    towers.data.map((tower) => (
                      <div
                        key={tower.id}
                        className="flex items-center justify-between px-5 py-3 text-sm"
                      >
                        <span className="font-medium text-ink">{tower.name}</span>
                        <span className="font-mono text-xs text-ink-subtle">
                          {tower.floors ? `${tower.floors} floors` : "Floors unset"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </StudioPane>

              <StudioPane className="h-fit">
                <StudioPaneHeader
                  title="Apartments"
                  subtitle={`${apartments.data?.total ?? 0} units registered`}
                />
                <form
                  className="grid gap-3 border-b border-line bg-surface-subtle/50 p-5 sm:grid-cols-2"
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
                      <Plus className="h-4 w-4" />
                      Add apartment
                    </Button>
                  </div>
                </form>

                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                        <th className="px-5 py-2">Unit</th>
                        <th className="py-2 pr-4">Tower</th>
                        <th className="py-2 pr-5 text-right">Floor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {apartments.data?.items.map((apartment) => {
                        const tower = towers.data?.find((t) => t.id === apartment.tower_id);
                        return (
                          <tr key={apartment.id} className="hover:bg-surface-subtle/50">
                            <td className="px-5 py-2.5 font-mono text-xs font-semibold text-ink">
                              {apartment.number}
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-ink-muted">
                              {tower?.name ?? "—"}
                            </td>
                            <td className="py-2.5 pr-5 text-right font-mono text-xs text-ink-subtle">
                              {apartment.floor ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </StudioPane>
            </div>
          ) : null}

          {activeTab === "parking" ? (
            <div className="space-y-6">
              <StudioPane>
                <StudioPaneHeader
                  title="Parking zones"
                  subtitle="Lower numeric priority fills first during automatic bay allocation"
                />
                <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
                  <form
                    className="space-y-3 border-b border-line bg-surface-subtle/40 p-5 lg:border-b-0 lg:border-r"
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
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Level">
                        <Input
                          value={zoneForm.level}
                          onChange={(event) =>
                            setZoneForm({ ...zoneForm, level: event.target.value })
                          }
                          placeholder="Basement 1"
                        />
                      </Field>
                      <Field label="Priority">
                        <Input
                          type="number"
                          min={1}
                          max={1000}
                          value={zoneForm.priority}
                          onChange={(event) =>
                            setZoneForm({ ...zoneForm, priority: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Category">
                      <Select
                        value={zoneForm.category}
                        onChange={(event) =>
                          setZoneForm({ ...zoneForm, category: event.target.value })
                        }
                      >
                        {ZONE_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {titleCase(category)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button type="submit" className="w-full" disabled={createZone.isPending}>
                      <Plus className="h-4 w-4" />
                      Create zone
                    </Button>
                  </form>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                          <th className="px-5 py-2.5">Zone</th>
                          <th className="py-2.5 pr-4">Category</th>
                          <th className="py-2.5 pr-4">Level</th>
                          <th className="py-2.5 pr-5 text-right">Priority</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {zones.data?.map((zone) => (
                          <tr key={zone.id} className="hover:bg-surface-subtle/50">
                            <td className="px-5 py-3 font-medium text-ink">{zone.name}</td>
                            <td className="py-3 pr-4">
                              <Badge tone="neutral">{titleCase(zone.category)}</Badge>
                            </td>
                            <td className="py-3 pr-4 text-xs text-ink-muted">
                              {zone.level ?? "—"}
                            </td>
                            <td className="py-3 pr-5 text-right font-mono text-xs text-ink-subtle">
                              P{zone.priority}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </StudioPane>

              <StudioPane>
                <StudioPaneHeader
                  title="Parking bays"
                  subtitle={`${slots.data?.total ?? 0} bays configured`}
                  action={
                    <SegmentedTabs
                      value={slotFilter}
                      onChange={setSlotFilter}
                      options={[
                        { value: "ALL", label: "All" },
                        { value: "AVAILABLE", label: "Available" },
                        { value: "OCCUPIED", label: "Occupied" },
                        { value: "BLOCKED", label: "Blocked" },
                      ]}
                    />
                  }
                />

                <form
                  className="grid gap-3 border-b border-line bg-surface-subtle/50 p-5 sm:grid-cols-4"
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
                      onChange={(event) =>
                        setSlotForm({ ...slotForm, zone_id: event.target.value })
                      }
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
                      <Plus className="h-4 w-4" />
                      Add bay
                    </Button>
                  </div>
                </form>

                {!slotRows.length ? (
                  <div className="p-6">
                    <EmptyState title="No parking bays match this filter" />
                  </div>
                ) : (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                          <th className="px-5 py-2.5">Code</th>
                          <th className="py-2.5 pr-4">Zone category</th>
                          <th className="py-2.5 pr-4">Vehicle class</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 pr-5 text-right">Control</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {slotRows.map((slot) => (
                          <tr key={slot.id} className="hover:bg-surface-subtle/50">
                            <td className="px-5 py-2.5 font-mono text-xs font-semibold text-ink">
                              {slot.code}
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-ink-muted">
                              {titleCase(slot.category)}
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-ink-muted">
                              {titleCase(slot.vehicle_category)}
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge tone={statusTone(slot.status)} dot>
                                {slot.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-5 text-right">
                              {slot.status === "AVAILABLE" ||
                              slot.status === "BLOCKED" ||
                              slot.status === "MAINTENANCE" ? (
                                slot.status !== "BLOCKED" ? (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() =>
                                      updateSlot.mutate({ slotId: slot.id, status: "BLOCKED" })
                                    }
                                  >
                                    Block bay
                                  </Button>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                      updateSlot.mutate({ slotId: slot.id, status: "AVAILABLE" })
                                    }
                                  >
                                    <Check className="h-3.5 w-3.5 text-ok" />
                                    Release
                                  </Button>
                                )
                              ) : (
                                <span className="text-xs text-ink-subtle">In active use</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </StudioPane>
            </div>
          ) : null}

          {activeTab === "policy" ? (
            <div className="space-y-6">
              <StudioPane>
                <StudioPaneHeader
                  title="Visitor & gate policy"
                  subtitle="Enforced server-side during QR verification and parking allocation"
                  action={<Settings2 className="h-4 w-4 text-ink-subtle" />}
                />
                {policy.data ? (
                  <form
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
                    <div className="divide-y divide-line px-5">
                      <div className="grid gap-4 py-4 sm:grid-cols-2">
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
                        <Field label="Allowed visitor window">
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
                      </div>

                      <div className="space-y-3 py-4">
                        <label className="flex items-center gap-2.5 text-sm text-ink">
                          <input
                            type="checkbox"
                            name="allow_manual_override"
                            defaultChecked={policy.data.allow_manual_override}
                            className="h-4 w-4 rounded border-line-strong accent-accent"
                          />
                          Allow audited manual gate override by security guards
                        </label>
                        <label className="flex items-center gap-2.5 text-sm text-ink">
                          <input
                            type="checkbox"
                            name="require_vehicle_for_entry"
                            defaultChecked={policy.data.require_vehicle_for_entry}
                            className="h-4 w-4 rounded border-line-strong accent-accent"
                          />
                          Require vehicle registration number before authorizing entry
                        </label>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-subtle px-5 py-3.5">
                      <div>
                        {updatePolicy.isSuccess ? <SuccessNote message="Policy saved" /> : null}
                      </div>
                      <Button type="submit" disabled={updatePolicy.isPending}>
                        <Check className="h-4 w-4" />
                        {updatePolicy.isPending ? "Saving…" : "Save policy"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="p-6">
                    <Spinner label="Loading policy…" />
                  </div>
                )}
              </StudioPane>

              {canCreateProperty ? (
                <StudioPane>
                  <StudioPaneHeader
                    title="Register new property"
                    subtitle="Each property enforces strict tenant isolation for bays, residents, and passes"
                  />
                  <form
                    className="grid gap-4 p-5 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createProperty.mutate(propertyForm);
                      setPropertyForm({
                        name: "",
                        address_line: "",
                        city: "",
                        state: "",
                        pincode: "",
                      });
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
                        <Building2 className="h-4 w-4" />
                        Register property
                      </Button>
                    </div>
                  </form>
                </StudioPane>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
