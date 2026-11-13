// Typed data access for the PIM attribute library (mirrors apps/api/src/modules/pim).
import { useQuery } from '@tanstack/react-query';
import api from '../../../lib/api';
import { useAuthStore } from '../../../store/authStore';

export type DataType = 'number' | 'text' | 'list' | 'boolean';
export const DATA_TYPE_LABELS: Record<DataType, string> = { number: 'Number', text: 'Text', list: 'List', boolean: 'Yes / no' };

export type Unit = { code: string; measure_code: string; symbol: string; factor: number; offset_value: number };
export type Measure = { code: string; name: string; base_unit: string; units: Unit[] };
export type AttributeGroup = { code: string; name: string; sort_order: number };

export type Attribute = {
  id: string;
  code: string;
  label: string;
  data_type: DataType;
  measure_code: string | null;
  default_unit: string | null;
  group_code: string;
  group_name: string;
  options: string[];
  min_value: number | null;
  max_value: number | null;
  description: string | null;
  storage: 'typed' | 'value';
  typed_source: string | null;
  is_system: boolean;
  active: boolean;
  sort_order: number;
  family_count: number;
  value_count: number;
};

export type Family = {
  id: string; code: string; name: string; category_code: string | null;
  attribute_count: number; required_count: number; product_count: number;
};

export type TemplateAttribute = Pick<Attribute, 'id' | 'code' | 'label' | 'data_type' | 'measure_code' | 'default_unit' | 'group_code' | 'group_name' | 'options' | 'min_value' | 'max_value' | 'storage' | 'is_system'> & {
  required: boolean; variant_axis: boolean; sort_order: number;
};

export type ItemAttribute = TemplateAttribute & { value: number | string | boolean | null; unit: string | null; unit_symbol: string | null };
export type ItemAttributes = {
  item: { id: string; product_code: string; product_name: string; product_family_id: string | null; product_family_name: string | null };
  attributes: ItemAttribute[];
  completeness: { required: number; filled: number; percent: number; missing: string[] };
};

const data = <T,>(url: string) => api.get(url).then(r => r.data.data as T);

export const pimKeys = {
  units: ['pim', 'units'] as const,
  groups: ['pim', 'groups'] as const,
  attributes: ['pim', 'attributes'] as const,
  families: ['pim', 'families'] as const,
  template: (familyId: string) => ['pim', 'template', familyId] as const,
  item: (itemId: string) => ['pim', 'item', itemId] as const,
};

export const useUnits = () => useQuery({ queryKey: pimKeys.units, queryFn: () => data<Measure[]>('/pim/units'), staleTime: Infinity });
export const useGroups = () => useQuery({ queryKey: pimKeys.groups, queryFn: () => data<AttributeGroup[]>('/pim/attribute-groups'), staleTime: 300_000 });
export const useAttributes = () => useQuery({ queryKey: pimKeys.attributes, queryFn: () => data<Attribute[]>('/pim/attributes') });
export const useFamilies = () => useQuery({ queryKey: pimKeys.families, queryFn: () => data<Family[]>('/pim/families') });
export const useTemplate = (familyId: string | null) => useQuery({
  queryKey: pimKeys.template(familyId ?? ''), enabled: !!familyId,
  queryFn: () => data<TemplateAttribute[]>(`/pim/families/${familyId}/attributes`),
});
export const useItemAttributes = (itemId: string) => useQuery({
  queryKey: pimKeys.item(itemId),
  queryFn: () => api.get(`/pim/items/${itemId}/attributes`).then(r => r.data as ItemAttributes),
});

/** Unit symbol lookup built from the measures list. */
export function unitSymbols(measures: Measure[] | undefined): Record<string, string> {
  return Object.fromEntries((measures ?? []).flatMap(m => m.units.map(u => [u.code, u.symbol])));
}

export function apiError(e: any, fallback: string): string {
  return e?.response?.data?.error?.message || fallback;
}

export function useCanManagePim() {
  const { user } = useAuthStore();
  return user?.role === 'admin' || user?.moduleAccess?.pim === 'manage';
}
