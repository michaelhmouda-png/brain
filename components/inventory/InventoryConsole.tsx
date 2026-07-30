'use client';

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeftRight, Boxes, ClipboardCheck, LoaderCircle,
  PackagePlus, Plus, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import {
  INVENTORY_UNITS,
  INVENTORY_QUANTITY_RULES,
  validateInventoryQuantityInput,
  type InventoryQuantityValidationCode,
  type InventoryStockRow,
  type InventoryUnit,
} from '@/lib/inventory/contracts';
import { inventoryMessages } from '@/lib/inventory/i18n';

type Location = { id: string; name: string; timezone: string };
type Area = { id: string; location_id: string; name: string; status: 'active'|'inactive' };
type InventoryPayload = {
  evaluatedAt: string;
  stock: InventoryStockRow[];
  locations: Location[];
  storageAreas: Area[];
  employees: { id: string; first_name: string; last_name: string; location_id: string|null }[];
  catalog: Array<{ id: string; name: string; description: string|null; category: string; canonical_unit: InventoryUnit; sku: string|null; barcode: string|null; status: 'active'|'inactive'; default_low_stock_threshold: string|null }>;
};
type CountLine = {
  id: string; inventory_item_id: string; canonical_unit_snapshot: InventoryUnit;
  expected_quantity: string; counted_quantity: string|null; damaged_quantity: string|null;
  note: string|null; inventory_items: { name: string; sku: string|null } | null;
};
type CountSession = {
  id: string; location_id: string; storage_area_id: string; status: string;
  notes: string|null; inventory_count_lines: CountLine[];
};
type ItemDetail = {
  item: {
    id: string; name: string; description: string|null; category: string; canonical_unit: InventoryUnit;
    sku: string|null; barcode: string|null; status: 'active'|'inactive'; default_low_stock_threshold: string|null;
  };
  balances: Array<{ location_id: string; storage_area_id: string; quantity: string; canonical_unit: InventoryUnit; last_movement_at: string|null }>;
  movements: Array<{ id: string; movement_type: keyof typeof inventoryMessages.en.movements; quantity_delta: string; balance_after: string; canonical_unit_snapshot: InventoryUnit; reason: string|null; source_type: string|null; created_at: string }>;
  countHistory: Array<{ session_id: string; expected_quantity: string; counted_quantity: string|null; damaged_quantity: string|null; variance: string|null }>;
  evaluatedAt: string;
};
type Sheet =
  | { kind: 'item' }
  | { kind: 'area' }
  | { kind: 'movement'; row: InventoryStockRow; type: 'receipt'|'usage'|'waste'|'adjustment_increase'|'adjustment_decrease' }
  | { kind: 'transfer'; row: InventoryStockRow }
  | { kind: 'count' }
  | { kind: 'detail'; row: InventoryStockRow }
  | null;

const jsonHeaders = { 'Content-Type': 'application/json' };
const localizedError = (code: string | null, language: 'en'|'ar') => {
  const errors = inventoryMessages[language].errors as Record<string, string>;
  return code && errors[code] || errors.INVENTORY_UNAVAILABLE;
};
const localizedQuantityError = (code: InventoryQuantityValidationCode, language: 'en'|'ar') =>
  (inventoryMessages[language].errors as Record<InventoryQuantityValidationCode, string>)[code];

async function safeFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok || body.data === undefined) throw new Error(body.error ?? 'INVENTORY_UNAVAILABLE');
  return body.data;
}

function Quantity({ value, unit, language }: { value: string; unit: string; language: 'en'|'ar' }) {
  return (
    <span className="inline-flex items-baseline gap-1" dir="ltr">
      <span className="tabular-nums">{new Intl.NumberFormat(language === 'ar' ? 'ar-LB' : 'en', { maximumFractionDigits: 6 }).format(Number(value))}</span>
      <span className="text-xs text-slate-400">{inventoryMessages[language].units[unit as InventoryUnit]}</span>
    </span>
  );
}

export function InventoryConsole() {
  const { language, role } = useLocale();
  const t = inventoryMessages[language];
  const management = role === 'manager' || role === 'owner' || role === 'super_admin';
  const [payload, setPayload] = useState<InventoryPayload | null>(null);
  const [counts, setCounts] = useState<CountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [storageAreaId, setStorageAreaId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (management) {
        const params = new URLSearchParams();
        if (locationId) params.set('locationId', locationId);
        if (storageAreaId) params.set('storageAreaId', storageAreaId);
        if (search.trim()) params.set('search', search.trim());
        if (category) params.set('category', category);
        if (lowOnly) params.set('lowOnly', 'true');
        const [inventory, countSessions] = await Promise.all([
          safeFetch<InventoryPayload>(`/api/inventory?${params}`),
          safeFetch<CountSession[]>('/api/inventory/counts'),
        ]);
        setPayload(inventory);
        setCounts(countSessions);
      } else {
        setCounts(await safeFetch<CountSession[]>('/api/inventory/counts'));
      }
    } catch (cause) {
      setError(localizedError(cause instanceof Error ? cause.message : null, language));
    } finally {
      setLoading(false);
    }
  }, [category, language, locationId, lowOnly, management, search, storageAreaId]);

  useEffect(() => {
    // The callback resolves asynchronously and owns loading/error lifecycle state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const availableAreas = useMemo(() => payload?.storageAreas.filter((area) =>
    area.status === 'active' && (!locationId || area.location_id === locationId)) ?? [], [payload, locationId]);
  const categories = useMemo(() => [...new Set(payload?.catalog.map((row) => row.category) ?? [])].sort(), [payload]);
  const lowCount = payload?.stock.filter((row) => row.is_low_stock).length ?? 0;

  if (!management) {
    return <EmployeeCounts counts={counts} loading={loading} error={error} reload={load} language={language} />;
  }

  return (
    <main className="min-w-0 space-y-5 pb-[max(6rem,env(safe-area-inset-bottom))] text-white" data-testid="inventory-console">
      <header className="flex flex-col gap-4 rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(8,47,73,.78),rgba(2,6,23,.92))] p-5 shadow-2xl sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.3em] text-cyan-300">{t.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{t.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">{t.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Action icon={Plus} label={t.addItem} onClick={() => setSheet({ kind: 'item' })} primary />
          <Action icon={Boxes} label={t.addArea} onClick={() => setSheet({ kind: 'area' })} />
          <Action icon={ClipboardCheck} label={t.startCount} onClick={() => setSheet({ kind: 'count' })} />
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2 sm:gap-4" aria-label={t.items}>
        <Metric label={t.items} value={payload?.catalog.length ?? 0} />
        <Metric label={t.totalUnits} value={payload?.stock.length ?? 0} />
        <Metric label={t.lowStock} value={lowCount} warning={lowCount > 0} />
      </section>

      <section className="grid gap-3 rounded-3xl border border-white/10 bg-white/[.04] p-3 backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1fr_auto]">
        <Filter label={t.location} value={locationId} onChange={(value) => { setLocationId(value); setStorageAreaId(''); }}>
          <option value="">{t.allLocations}</option>
          {payload?.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </Filter>
        <Filter label={t.storage} value={storageAreaId} onChange={setStorageAreaId}>
          <option value="">{t.allStorage}</option>
          {availableAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </Filter>
        <label className="relative">
          <span className="sr-only">{t.search}</span>
          <Search className="pointer-events-none absolute start-3 top-3.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search}
            className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 ps-10 pe-3 text-sm outline-none focus:border-cyan-400" />
        </label>
        <Filter label={t.category} value={category} onChange={setCategory}>
          <option value="">{t.allCategories}</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </Filter>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm">
          <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} className="accent-cyan-400" />
          <span className="whitespace-nowrap">{t.lowOnly}</span>
        </label>
      </section>

      {loading && <State icon={LoaderCircle} text={t.loading} spin />}
      {error && <State icon={AlertTriangle} text={t.unavailable} action={t.retry} onAction={() => void load()} />}
      {!loading && !error && payload?.stock.length === 0 && payload.catalog.length === 0 && <State icon={SlidersHorizontal} text={t.empty} />}
      {!loading && !error && payload && payload.stock.length === 0 && payload.catalog.length > 0 && (
        <section className="grid gap-3 xl:grid-cols-2">
          {payload.catalog.filter((item) =>
            (!search.trim() || `${item.name} ${item.sku ?? ''} ${item.barcode ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
            && (!category || item.category === category)
            && !lowOnly
          ).map((item) => (
            <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/65 p-4">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{item.name}</h2><p className="mt-1 text-xs text-slate-400">{item.category} · {t.units[item.canonical_unit]}</p></div><span className="rounded-full bg-white/[.06] px-2 py-1 text-[11px] text-slate-300">{item.status === 'active' ? t.active : t.inactive}</span></div>
              <p className="mt-4 text-sm text-slate-400">{t.noStorageConfigured}</p>
            </article>
          ))}
        </section>
      )}
      {!loading && !error && payload && payload.stock.length > 0 && (
        <section className="grid gap-3 xl:grid-cols-2" aria-live="polite">
          {payload.stock.map((row) => (
            <article key={`${row.item_id}:${row.storage_area_id}`} className="group min-w-0 rounded-2xl border border-white/10 bg-slate-950/65 p-4 transition hover:border-cyan-400/40">
              <button type="button" className="w-full min-w-0 text-start" onClick={() => setSheet({ kind: 'detail', row })}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold">{row.item_name}</h2>
                    <p className="mt-1 truncate text-xs text-slate-400">{row.category} · {row.location_name} · {row.storage_area_name}</p>
                  </div>
                  {row.is_low_stock && <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-bold text-amber-300">{t.lowStock}</span>}
                </div>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-slate-500">{t.quantity}</p>
                    <p className="mt-1 text-2xl font-black"><Quantity value={row.quantity} unit={row.canonical_unit} language={language} /></p>
                  </div>
                  <p className="text-end text-xs text-slate-500">{t.lastMovement}<br />{row.last_movement_at ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.last_movement_at)) : t.never}</p>
                </div>
              </button>
              <div className="mt-4 flex gap-2 overflow-x-auto border-t border-white/10 pt-3">
                <MiniAction label={t.receive} icon={PackagePlus} onClick={() => setSheet({ kind: 'movement', row, type: 'receipt' })} />
                <MiniAction label={t.use} icon={Boxes} onClick={() => setSheet({ kind: 'movement', row, type: 'usage' })} />
                <MiniAction label={t.waste} icon={Trash2} onClick={() => setSheet({ kind: 'movement', row, type: 'waste' })} />
                <MiniAction label={t.transfer} icon={ArrowLeftRight} onClick={() => setSheet({ kind: 'transfer', row })} />
              </div>
            </article>
          ))}
        </section>
      )}
      {!loading && !error && counts.length > 0 && <ManagementCounts counts={counts} reload={load} language={language} />}
      {sheet && <InventorySheet sheet={sheet} payload={payload} language={language} close={() => setSheet(null)} completed={async () => { setSheet(null); await load(); }} />}
    </main>
  );
}

function Action({ icon: Icon, label, onClick, primary = false }: { icon: typeof Plus; label: string; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${primary ? 'bg-cyan-300 text-slate-950' : 'border border-white/15 bg-white/10 text-white'}`}><Icon className="h-4 w-4" />{label}</button>;
}
function MiniAction({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/[.06] px-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><Icon className="h-3.5 w-3.5" />{label}</button>;
}
function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[.04] p-3 sm:p-4"><p className="truncate text-[11px] uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-1 text-2xl font-black ${warning ? 'text-amber-300' : 'text-white'}`}>{value}</p></div>;
}
function Filter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm outline-none focus:border-cyan-400">{children}</select></label>;
}
function State({ icon: Icon, text, spin, action, onAction }: { icon: typeof Plus; text: string; spin?: boolean; action?: string; onAction?: () => void }) {
  return <div className="grid min-h-56 place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[.03] p-8 text-center"><div><Icon className={`mx-auto h-7 w-7 text-slate-400 ${spin ? 'animate-spin' : ''}`} /><p className="mt-3 text-sm text-slate-300">{text}</p>{action && <button className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold" onClick={onAction}>{action}</button>}</div></div>;
}

function InventorySheet({ sheet, payload, language, close, completed }: { sheet: Exclude<Sheet, null>; payload: InventoryPayload|null; language: 'en'|'ar'; close: () => void; completed: () => Promise<void> }) {
  const t = inventoryMessages[language];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quantityErrors, setQuantityErrors] = useState<Record<string, InventoryQuantityValidationCode>>({});
  const [detail, setDetail] = useState<ItemDetail|null>(null);
  const [threshold, setThreshold] = useState(sheet.kind === 'detail' ? sheet.row.effective_threshold ?? '' : '');
  const activeAreas = payload?.storageAreas.filter((area) => area.status === 'active') ?? [];
  const clearQuantityError = (field: string) => {
    setQuantityErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };
  useEffect(() => {
    if (sheet.kind !== 'detail') return;
    const controller = new AbortController();
    void safeFetch<ItemDetail>(`/api/inventory/items/${sheet.row.item_id}`, { signal: controller.signal })
      .then(setDetail)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(localizedError(cause instanceof Error ? cause.message : null, language));
      });
    return () => controller.abort();
  }, [language, sheet]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const nextQuantityErrors: Record<string, InventoryQuantityValidationCode> = {};
    const canonicalQuantities: Record<string, string | null> = {};
    const validateQuantity = (name: string, options: { required: boolean; positive?: boolean }) => {
      const result = validateInventoryQuantityInput(form.get(name), options);
      if (result.ok) canonicalQuantities[name] = result.value;
      else nextQuantityErrors[name] = result.code;
    };
    if (sheet.kind === 'item') validateQuantity('threshold', INVENTORY_QUANTITY_RULES.itemThreshold);
    if (sheet.kind === 'movement') validateQuantity('quantity', INVENTORY_QUANTITY_RULES.movementQuantity);
    if (sheet.kind === 'transfer') validateQuantity('quantity', INVENTORY_QUANTITY_RULES.transferQuantity);
    setQuantityErrors(nextQuantityErrors);
    if (Object.keys(nextQuantityErrors).length > 0) return;

    setBusy(true);
    try {
      if (sheet.kind === 'item') {
        await safeFetch('/api/inventory', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({
          name: form.get('name'), description: form.get('description'), category: form.get('category'),
          canonicalUnit: form.get('unit'), sku: form.get('sku'), barcode: form.get('barcode'),
          defaultLowStockThreshold: canonicalQuantities.threshold,
        }) });
      } else if (sheet.kind === 'area') {
        await safeFetch('/api/inventory/storage-areas', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({
          locationId: form.get('locationId'), name: form.get('name'), description: form.get('description'),
        }) });
      } else if (sheet.kind === 'movement') {
        await safeFetch('/api/inventory/operations', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({
          operation: 'movement', idempotencyKey: crypto.randomUUID(), locationId: sheet.row.location_id,
          storageAreaId: sheet.row.storage_area_id, inventoryItemId: sheet.row.item_id, type: sheet.type,
          quantity: canonicalQuantities.quantity, reason: form.get('reason'),
        }) });
      } else if (sheet.kind === 'transfer') {
        await safeFetch('/api/inventory/operations', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({
          operation: 'transfer', idempotencyKey: crypto.randomUUID(), locationId: sheet.row.location_id,
          sourceStorageAreaId: sheet.row.storage_area_id, destinationStorageAreaId: form.get('destination'),
          inventoryItemId: sheet.row.item_id, quantity: canonicalQuantities.quantity, reason: form.get('reason'),
        }) });
      } else if (sheet.kind === 'count') {
        const areaId = String(form.get('storageAreaId'));
        const area = activeAreas.find((value) => value.id === areaId);
        await safeFetch('/api/inventory/counts', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({
          locationId: area?.location_id, storageAreaId: areaId,
          assignedEmployeeId: form.get('assignedEmployeeId') || null, notes: form.get('notes'),
        }) });
      }
      await completed();
    } catch (cause) {
      setError(localizedError(cause instanceof Error ? cause.message : null, language));
    } finally { setBusy(false); }
  };
  const toggleItemStatus = async () => {
    if (sheet.kind !== 'detail' || !detail) return;
    setBusy(true); setError('');
    try {
      await safeFetch(`/api/inventory/items/${detail.item.id}`, {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({
          name: detail.item.name, description: detail.item.description, category: detail.item.category,
          canonicalUnit: detail.item.canonical_unit, sku: detail.item.sku, barcode: detail.item.barcode,
          defaultLowStockThreshold: detail.item.default_low_stock_threshold,
          status: detail.item.status === 'active' ? 'inactive' : 'active',
        }),
      });
      await completed();
    } catch (cause) {
      setError(localizedError(cause instanceof Error ? cause.message : null, language));
    } finally { setBusy(false); }
  };
  const inactivateArea = async (areaId: string) => {
    setBusy(true); setError('');
    try {
      await safeFetch(`/api/inventory/storage-areas/${areaId}`, {
        method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ status: 'inactive' }),
      });
      await completed();
    } catch (cause) {
      setError(localizedError(cause instanceof Error ? cause.message : null, language));
    } finally { setBusy(false); }
  };
  const saveThreshold = async () => {
    if (sheet.kind !== 'detail') return;
    const validation = validateInventoryQuantityInput(threshold, INVENTORY_QUANTITY_RULES.lowStockThreshold);
    if (!validation.ok) {
      setQuantityErrors({ detailThreshold: validation.code });
      return;
    }
    setQuantityErrors({});
    setBusy(true); setError('');
    try {
      await safeFetch('/api/inventory/thresholds', {
        method: 'PUT', headers: jsonHeaders, body: JSON.stringify({
          locationId: sheet.row.location_id, storageAreaId: sheet.row.storage_area_id,
          inventoryItemId: sheet.row.item_id, threshold: validation.value,
        }),
      });
      await completed();
    } catch (cause) {
      setError(localizedError(cause instanceof Error ? cause.message : null, language));
    } finally { setBusy(false); }
  };

  const title = sheet.kind === 'item' ? t.addItem : sheet.kind === 'area' ? t.addArea
    : sheet.kind === 'transfer' ? t.transfer : sheet.kind === 'count' ? t.startCount
    : sheet.kind === 'detail' ? sheet.row.item_name : t[sheet.type === 'receipt' ? 'receive' : sheet.type === 'usage' ? 'use' : sheet.type === 'waste' ? 'waste' : 'adjust'];
  const submitLabel = sheet.kind === 'transfer' ? t.confirmTransfer
    : sheet.kind === 'movement' ? t.confirmOperation
    : sheet.kind === 'count' ? t.confirmCount : t.save;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="inventory-sheet-title">
      <section className="flex max-h-[min(92dvh,760px)] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-slate-950 shadow-2xl sm:rounded-[28px]">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
          <h2 id="inventory-sheet-title" className="text-lg font-black">{title}</h2>
          <button onClick={close} aria-label={t.close} className="grid h-11 w-11 place-items-center rounded-xl bg-white/[.06]"><X className="h-5 w-5" /></button>
        </header>
        {sheet.kind === 'detail' ? (
          <div className="min-h-0 overflow-y-auto p-5 [-webkit-overflow-scrolling:touch]">
            <p className="text-sm text-slate-400">{sheet.row.category} · {sheet.row.location_name} · {sheet.row.storage_area_name}</p>
            <p className="mt-6 text-4xl font-black"><Quantity value={sheet.row.quantity} unit={sheet.row.canonical_unit} language={language} /></p>
            <dl className="mt-6 grid gap-3 rounded-2xl bg-white/[.04] p-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-400">{t.threshold}</dt><dd>{sheet.row.effective_threshold ?? t.unknown}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">{t.sku}</dt><dd className="font-mono" dir="ltr">{sheet.row.sku ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">{t.barcode}</dt><dd className="font-mono" dir="ltr">{sheet.row.barcode ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">{t.status}</dt><dd>{sheet.row.item_status === 'active' ? t.active : t.inactive}</dd></div>
            </dl>
            <section className="mt-5">
              <h3 className="font-bold">{t.balances}</h3>
              <div className="mt-2 space-y-2">
                {!detail && !error && <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" />}
                {detail?.balances.map((balance) => <div key={`${balance.location_id}:${balance.storage_area_id}`} className="flex justify-between rounded-xl bg-white/[.04] p-3 text-sm"><span>{payload?.storageAreas.find((area) => area.id === balance.storage_area_id)?.name ?? balance.storage_area_id}</span><Quantity value={balance.quantity} unit={balance.canonical_unit} language={language} /></div>)}
              </div>
            </section>
            <section className="mt-5">
              <h3 className="font-bold">{t.history}</h3>
              <div className="mt-2 space-y-2">
                {detail?.movements.slice(0, 20).map((movement) => <div key={movement.id} className="rounded-xl bg-white/[.04] p-3 text-sm"><div className="flex justify-between gap-3"><span>{t.movements[movement.movement_type] ?? movement.movement_type}</span><span className="tabular-nums" dir="ltr">{movement.quantity_delta} {t.units[movement.canonical_unit_snapshot]}</span></div><p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat(language === 'ar' ? 'ar-LB' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(movement.created_at))} · {movement.source_type ?? t.unknown}</p></div>)}
              </div>
            </section>
            <section className="mt-5">
              <h3 className="font-bold">{t.assignedCounts}</h3>
              <p className="mt-2 text-sm text-slate-400">{detail ? `${detail.countHistory.length}` : '—'}</p>
            </section>
            <div className="mt-5 flex items-end gap-2">
              <DecimalInput
                label={t.threshold}
                value={threshold}
                {...INVENTORY_QUANTITY_RULES.lowStockThreshold}
                language={language}
                errorCode={quantityErrors.detailThreshold}
                onChange={(event) => {
                  setThreshold(event.target.value);
                  clearQuantityError('detailThreshold');
                }}
              />
              <button type="button" disabled={busy || !threshold} onClick={() => void saveThreshold()} className="mb-0 min-h-12 shrink-0 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">{t.save}</button>
            </div>
            {error && <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
            <p className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/[.06] p-3 text-xs text-cyan-100">{t.noDirectMutation}</p>
            {detail && <button type="button" disabled={busy} onClick={() => void toggleItemStatus()} className="mt-4 min-h-11 w-full rounded-xl border border-white/15 bg-white/[.06] px-4 text-sm font-bold disabled:opacity-50">{detail.item.status === 'active' ? t.inactivateItem : t.reactivateItem}</button>}
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 space-y-4 overflow-y-auto p-5 [-webkit-overflow-scrolling:touch]">
              {sheet.kind === 'item' && <>
                <Input name="name" label={t.itemName} required maxLength={160} />
                <Input name="category" label={t.category} required maxLength={80} />
                <label className="block text-sm text-slate-300">{t.unit}<select name="unit" required className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-3">{INVENTORY_UNITS.map((unit) => <option key={unit} value={unit}>{t.units[unit]}</option>)}</select></label>
                <Input name="sku" label={t.sku} maxLength={80} dir="ltr" />
                <Input name="barcode" label={t.barcode} maxLength={128} dir="ltr" />
                <DecimalInput
                  name="threshold"
                  label={t.threshold}
                  language={language}
                  {...INVENTORY_QUANTITY_RULES.itemThreshold}
                  errorCode={quantityErrors.threshold}
                  onChange={() => clearQuantityError('threshold')}
                />
                <Input name="description" label={t.descriptionLabel} maxLength={2000} />
              </>}
              {sheet.kind === 'area' && <>
                <label className="block text-sm text-slate-300">{t.location}<select name="locationId" required className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-3">{payload?.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <Input name="name" label={t.storage} required maxLength={160} />
                <Input name="description" label={t.descriptionLabel} maxLength={1000} />
                {activeAreas.length > 0 && <div className="space-y-2 border-t border-white/10 pt-4">{activeAreas.map((area) => <div key={area.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[.04] p-3 text-sm"><span className="truncate">{area.name}</span><button type="button" disabled={busy} onClick={() => void inactivateArea(area.id)} className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300">{t.inactive}</button></div>)}</div>}
              </>}
              {(sheet.kind === 'movement' || sheet.kind === 'transfer') && <>
                <p className="rounded-xl bg-white/[.04] p-3 text-sm">{sheet.row.item_name} · {sheet.row.storage_area_name}<br /><span className="text-slate-400">{t.quantity}: </span><Quantity value={sheet.row.quantity} unit={sheet.row.canonical_unit} language={language} /></p>
                {sheet.kind === 'transfer' && <label className="block text-sm text-slate-300">{t.storage}<select name="destination" required className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-3"><option value="">{t.allStorage}</option>{activeAreas.filter((area) => area.location_id === sheet.row.location_id && area.id !== sheet.row.storage_area_id).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>}
                <DecimalInput
                  name="quantity"
                  label={`${t.quantity} (${t.units[sheet.row.canonical_unit]})`}
                  {...(sheet.kind === 'movement'
                    ? INVENTORY_QUANTITY_RULES.movementQuantity
                    : INVENTORY_QUANTITY_RULES.transferQuantity)}
                  language={language}
                  errorCode={quantityErrors.quantity}
                  onChange={() => clearQuantityError('quantity')}
                />
                <Input name="reason" label={t.note} maxLength={1000} />
                <p className="text-xs text-slate-500">{t.decimalHint}</p>
              </>}
              {sheet.kind === 'count' && <>
                <label className="block text-sm text-slate-300">{t.storage}<select name="storageAreaId" required className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-3"><option value="">{t.allStorage}</option>{activeAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
                <label className="block text-sm text-slate-300">{t.assignedCounts}<select name="assignedEmployeeId" className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-3"><option value="">—</option>{payload?.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</option>)}</select></label>
                <Input name="notes" label={t.note} maxLength={1000} />
              </>}
              {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
            </div>
            <footer className="shrink-0 border-t border-white/10 bg-slate-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button disabled={busy} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-300 px-4 font-black text-slate-950 disabled:opacity-50">{busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : submitLabel}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
function Input(props: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...input } = props;
  return <label className="block text-sm text-slate-300">{label}<input {...input} className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-white outline-none focus:border-cyan-400" /></label>;
}

type DecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'|'pattern'|'inputMode'|'min'|'max'|'step'|'required'
> & {
  label: string;
  language: 'en'|'ar';
  required?: boolean;
  positive?: boolean;
  errorCode?: InventoryQuantityValidationCode;
};

function DecimalInput({
  label,
  language,
  required = false,
  positive = false,
  errorCode,
  id,
  onBlur,
  onChange,
  ...input
}: DecimalInputProps) {
  const generatedId = useId();
  const inputId = id ?? `inventory-decimal-${generatedId.replace(/:/g, '')}`;
  const errorId = `${inputId}-error`;
  const [localError, setLocalError] = useState<InventoryQuantityValidationCode | undefined>();
  const displayedError = errorCode ?? localError;
  const validate = (value: string) => {
    const result = validateInventoryQuantityInput(value, { required, positive });
    setLocalError(result.ok ? undefined : result.code);
  };

  return (
    <label className="block min-w-0 text-sm text-slate-300" htmlFor={inputId}>
      {label}
      <input
        {...input}
        id={inputId}
        type="text"
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        aria-required={required || undefined}
        aria-invalid={displayedError ? true : undefined}
        aria-describedby={displayedError ? errorId : undefined}
        onBlur={(event) => {
          validate(event.currentTarget.value);
          onBlur?.(event);
        }}
        onChange={(event) => {
          if (localError) validate(event.currentTarget.value);
          onChange?.(event);
        }}
        className={`mt-1 h-12 w-full rounded-xl border bg-slate-900 px-3 text-white outline-none ${
          displayedError ? 'border-rose-400 focus:border-rose-300' : 'border-white/10 focus:border-cyan-400'
        }`}
      />
      {displayedError && (
        <span id={errorId} role="alert" className="mt-1 block text-xs text-rose-300">
          {localizedQuantityError(displayedError, language)}
        </span>
      )}
    </label>
  );
}

function EmployeeCounts({ counts, loading, error, reload, language }: { counts: CountSession[]; loading: boolean; error: string|null; reload: () => Promise<void>; language: 'en'|'ar' }) {
  const t = inventoryMessages[language];
  return <main className="space-y-4 pb-[max(6rem,env(safe-area-inset-bottom))] text-white" data-testid="assigned-inventory-counts">
    <header className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(8,47,73,.8),rgba(2,6,23,.94))] p-6"><p className="text-xs font-bold uppercase tracking-[.3em] text-cyan-300">{t.eyebrow}</p><h1 className="mt-2 text-3xl font-black">{t.assignedCounts}</h1><p className="mt-2 text-sm text-slate-300">{t.countExpectedProtected}</p></header>
    {loading && <State icon={LoaderCircle} text={t.loading} spin />}
    {error && <State icon={AlertTriangle} text={t.unavailable} action={t.retry} onAction={() => void reload()} />}
    {!loading && !error && counts.length === 0 && <State icon={ClipboardCheck} text={t.noCounts} />}
    {counts.map((session) => <CountCard key={session.id} session={session} t={t} reload={reload} language={language} />)}
  </main>;
}
function ManagementCounts({ counts, reload, language }: { counts: CountSession[]; reload: () => Promise<void>; language: 'en'|'ar' }) {
  const t = inventoryMessages[language];
  const [busyId, setBusyId] = useState<string|null>(null);
  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await safeFetch(`/api/inventory/counts/${id}`, {
        method: 'PATCH', headers: jsonHeaders,
        body: JSON.stringify({ action: 'approve', idempotencyKey: crypto.randomUUID() }),
      });
      await reload();
    } finally { setBusyId(null); }
  };
  return <section className="rounded-3xl border border-white/10 bg-white/[.04] p-4">
    <h2 className="font-black">{t.assignedCounts}</h2>
    <div className="mt-3 grid gap-2 lg:grid-cols-2">
      {counts.slice(0, 12).map((session) => <article key={session.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-950/70 p-3">
        <div className="min-w-0"><p className="truncate text-sm font-bold">{session.notes || t.startCount}</p><p className="text-xs text-slate-400">{session.status} · {session.inventory_count_lines.length} {t.items}</p></div>
        {session.status === 'submitted' && <button disabled={busyId === session.id} onClick={() => void approve(session.id)} className="min-h-10 shrink-0 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 disabled:opacity-50">{t.approved}</button>}
      </article>)}
    </div>
  </section>;
}
function CountCard({
  session,
  t,
  reload,
  language,
}: {
  session: CountSession;
  t: (typeof inventoryMessages)[keyof typeof inventoryMessages];
  reload: () => Promise<void>;
  language: 'en'|'ar';
}) {
  const [values, setValues] = useState<Record<string, { counted: string; damaged: string; note: string }>>(
    () => Object.fromEntries(session.inventory_count_lines.map((line) => [
      line.id,
      {
        counted: line.counted_quantity ?? '',
        damaged: line.damaged_quantity ?? '',
        note: line.note ?? '',
      },
    ])),
  );
  const [quantityErrors, setQuantityErrors] = useState<Record<string, InventoryQuantityValidationCode>>({});
  const [busy, setBusy] = useState(false);
  const clearQuantityError = (field: string) => {
    setQuantityErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };
  const act = async (action: 'start'|'save'|'submit') => {
    let lines: Array<{ lineId: string; countedQuantity: string; damagedQuantity: string|null; note: string|null }> = [];
    if (action !== 'start') {
      const nextErrors: Record<string, InventoryQuantityValidationCode> = {};
      lines = session.inventory_count_lines.map((line) => {
        const counted = validateInventoryQuantityInput(
          values[line.id]?.counted ?? '',
          INVENTORY_QUANTITY_RULES.countQuantity,
        );
        const damaged = validateInventoryQuantityInput(
          values[line.id]?.damaged ?? '',
          INVENTORY_QUANTITY_RULES.damagedQuantity,
        );
        if (!counted.ok) nextErrors[`${line.id}:counted`] = counted.code;
        if (!damaged.ok) nextErrors[`${line.id}:damaged`] = damaged.code;
        return {
          lineId: line.id,
          countedQuantity: counted.ok ? counted.value ?? '' : '',
          damagedQuantity: damaged.ok ? damaged.value : null,
          note: values[line.id]?.note || null,
        };
      });
      setQuantityErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) return;
    }

    setBusy(true);
    try {
      if (action === 'submit') {
        await safeFetch(`/api/inventory/counts/${session.id}`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ action: 'save', lines }),
        });
      }
      await safeFetch(`/api/inventory/counts/${session.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ action, ...(action === 'save' ? { lines } : {}) }),
      });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex justify-between">
        <h2 className="font-black">{t.startCount}</h2>
        <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-xs text-cyan-300">
          {t[session.status as keyof typeof t] as string ?? session.status}
        </span>
      </div>
      {session.status === 'draft' ? (
        <button disabled={busy} onClick={() => void act('start')} className="mt-4 min-h-12 w-full rounded-xl bg-cyan-300 font-black text-slate-950">
          {t.startCount}
        </button>
      ) : session.status === 'counting' ? (
        <>
          <div className="mt-4 space-y-3">
            {session.inventory_count_lines.map((line) => (
              <div key={line.id} className="rounded-2xl bg-white/[.04] p-3">
                <p className="font-bold">{line.inventory_items?.name ?? line.inventory_item_id}</p>
                <p className="text-xs text-slate-400">{line.canonical_unit_snapshot}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <DecimalInput
                    label={t.counted}
                    language={language}
                    {...INVENTORY_QUANTITY_RULES.countQuantity}
                    value={values[line.id]?.counted}
                    errorCode={quantityErrors[`${line.id}:counted`]}
                    onChange={(event) => {
                      clearQuantityError(`${line.id}:counted`);
                      setValues((current) => ({
                        ...current,
                        [line.id]: { ...current[line.id], counted: event.target.value },
                      }));
                    }}
                  />
                  <DecimalInput
                    label={t.damaged}
                    language={language}
                    {...INVENTORY_QUANTITY_RULES.damagedQuantity}
                    value={values[line.id]?.damaged}
                    errorCode={quantityErrors[`${line.id}:damaged`]}
                    onChange={(event) => {
                      clearQuantityError(`${line.id}:damaged`);
                      setValues((current) => ({
                        ...current,
                        [line.id]: { ...current[line.id], damaged: event.target.value },
                      }));
                    }}
                  />
                </div>
                <Input
                  label={t.note}
                  value={values[line.id]?.note}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    [line.id]: { ...current[line.id], note: event.target.value },
                  }))}
                />
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 border-t border-white/10 bg-slate-950 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
            <button disabled={busy} onClick={() => void act('save')} className="min-h-12 rounded-xl bg-white/10 font-bold">
              {t.saveDraft}
            </button>
            <button disabled={busy} onClick={() => void act('submit')} className="min-h-12 rounded-xl bg-cyan-300 font-black text-slate-950">
              {t.submitCount}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4 space-y-2">
          {session.inventory_count_lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[.04] p-3">
              <span className="min-w-0 truncate text-sm">{line.inventory_items?.name ?? line.inventory_item_id}</span>
              <span className="shrink-0 tabular-nums" dir="ltr">
                {line.counted_quantity ?? '—'} {line.canonical_unit_snapshot}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
